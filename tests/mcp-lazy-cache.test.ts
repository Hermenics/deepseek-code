import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { approveMcpConfig, loadMcpTools } from '../src/agent/mcp.js'
import { WorkspaceTrustStore } from '../src/settings/trust.js'
import { sandboxAvailable } from '../src/utils/platform.js'

const roots: string[] = []
const sandboxTest = it.skipIf(!sandboxAvailable())

afterEach(async () => Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))))

describe('MCP stdio schema cache', () => {
  sandboxTest('reuses an approved exact-hash schema lazily and rejects a live catalog change before calling a tool', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-mcp-lazy-cache-'))
    roots.push(root)
    const project = join(root, 'project')
    const trustFile = join(root, 'trust.json')
    await mkdir(join(project, '.deepseek'), { recursive: true })
    const schemaVersionFile = join(project, 'schema-version')
    await writeFile(schemaVersionFile, 'early')
    const script = `
let buffer = ''
function reply(id, result) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\\n') }
process.stdin.setEncoding('utf8')
process.stdin.on('data', chunk => {
  buffer += chunk
  let end
  while ((end = buffer.indexOf('\\n')) >= 0) {
    const line = buffer.slice(0, end); buffer = buffer.slice(end + 1)
    if (!line) continue
    const request = JSON.parse(line)
    if (request.id === undefined) continue
    if (request.method === 'initialize') reply(request.id, { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'cache-fixture', version: '1.0' } })
    else if (request.method === 'tools/list') {
      const description = require('node:fs').readFileSync(${JSON.stringify(schemaVersionFile)}, 'utf8').trim()
      reply(request.id, { tools: [{ name: 'probe', description: 'probe', inputSchema: { type: 'object', properties: { value: { type: 'string', description } } } }] })
    }
    else if (request.method === 'tools/call') reply(request.id, { content: [{ type: 'text', text: 'tool was called' }] })
  }
})
`
    await writeFile(join(project, '.deepseek', 'mcp.json'), JSON.stringify({
      servers: { fixture: { transport: 'stdio', command: process.execPath, args: ['-e', script] } },
    }))

    const options = { enabled: true, trustFile, initialTimeoutMs: 5_000 }
    const pending = await loadMcpTools(project, options)
    expect(pending.approval).toBeDefined()
    await approveMcpConfig(project, pending.approval!, trustFile)
    const cold = await loadMcpTools(project, options)
    try {
      expect(cold.errors).toEqual([])
      expect((cold.tools[0]?.parameters as any).properties.value.description).toBe('early')
    } finally {
      await cold.cleanup?.()
    }

    await writeFile(schemaVersionFile, 'late')
    const warm = await loadMcpTools(project, options)
    try {
      expect(warm.errors).toEqual([])
      expect((warm.tools[0]?.parameters as any).properties.value.description).toBe('early')
      await expect(warm.tools[0]!.execute({ value: 'x' })).rejects.toThrow('catalog changed')
    } finally {
      await warm.cleanup?.()
    }
  }, 15_000)

  sandboxTest('refreshes an empty cached catalog so newly added tools become available', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-mcp-lazy-cache-empty-catalog-'))
    roots.push(root)
    const project = join(root, 'project')
    const trustFile = join(root, 'trust.json')
    const catalogState = join(project, 'catalog-state')
    await mkdir(join(project, '.deepseek'), { recursive: true })
    await writeFile(catalogState, 'empty')
    const script = `
const fs = require('node:fs')
let buffer = ''
function reply(id, result) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\\n') }
process.stdin.setEncoding('utf8')
process.stdin.on('data', chunk => {
  buffer += chunk
  let end
  while ((end = buffer.indexOf('\\n')) >= 0) {
    const line = buffer.slice(0, end); buffer = buffer.slice(end + 1)
    if (!line) continue
    const request = JSON.parse(line)
    if (request.id === undefined) continue
    if (request.method === 'initialize') reply(request.id, { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'empty-catalog-fixture', version: '1.0' } })
    else if (request.method === 'tools/list') {
      const tools = fs.readFileSync(${JSON.stringify(catalogState)}, 'utf8').trim() === 'available'
        ? [{ name: 'new-tool', description: 'newly added', inputSchema: { type: 'object' } }]
        : []
      reply(request.id, { tools })
    }
    else if (request.method === 'tools/call') reply(request.id, { content: [{ type: 'text', text: 'new tool called' }] })
  }
})
`
    await writeFile(join(project, '.deepseek', 'mcp.json'), JSON.stringify({
      servers: { fixture: { transport: 'stdio', command: process.execPath, args: ['-e', script] } },
    }))

    const options = { enabled: true, trustFile, initialTimeoutMs: 5_000 }
    const pending = await loadMcpTools(project, options)
    await approveMcpConfig(project, pending.approval!, trustFile)
    const cold = await loadMcpTools(project, options)
    expect(cold.tools).toHaveLength(0)
    expect(await new WorkspaceTrustStore(project, trustFile).getMcpSchemas(pending.approval!)).toEqual({ fixture: [] })
    await cold.cleanup?.()

    await writeFile(catalogState, 'available')
    const refreshed = await loadMcpTools(project, options)
    try {
      expect(refreshed.errors).toEqual([])
      expect(refreshed.tools.map(tool => tool.name)).toEqual(['fixture__new-tool'])
      await expect(refreshed.tools[0]!.execute({})).resolves.toBe('new tool called')
    } finally {
      await refreshed.cleanup?.()
    }
  }, 15_000)

  sandboxTest('keeps live tools available when optional schema cache persistence fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-mcp-lazy-cache-write-failure-'))
    roots.push(root)
    const project = join(root, 'project')
    const trustFile = join(root, 'trust.json')
    await mkdir(join(project, '.deepseek'), { recursive: true })
    const script = `
let buffer = ''
function reply(id, result) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\\n') }
process.stdin.setEncoding('utf8')
process.stdin.on('data', chunk => {
  buffer += chunk
  let end
  while ((end = buffer.indexOf('\\n')) >= 0) {
    const line = buffer.slice(0, end); buffer = buffer.slice(end + 1)
    if (!line) continue
    const request = JSON.parse(line)
    if (request.id === undefined) continue
    if (request.method === 'initialize') reply(request.id, { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'cache-write-fixture', version: '1.0' } })
    else if (request.method === 'tools/list') reply(request.id, { tools: [{ name: 'probe', description: 'probe', inputSchema: { type: 'object' } }] })
    else if (request.method === 'tools/call') reply(request.id, { content: [{ type: 'text', text: 'tool was called' }] })
  }
})
`
    await writeFile(join(project, '.deepseek', 'mcp.json'), JSON.stringify({
      servers: { fixture: { transport: 'stdio', command: process.execPath, args: ['-e', script] } },
    }))

    const options = { enabled: true, trustFile, initialTimeoutMs: 5_000 }
    const pending = await loadMcpTools(project, options)
    await approveMcpConfig(project, pending.approval!, trustFile)
    const saveSchemas = spyOn(WorkspaceTrustStore.prototype, 'saveMcpSchemas')
      .mockRejectedValue(new Error('fixture storage unavailable'))
    let loaded: Awaited<ReturnType<typeof loadMcpTools>> | undefined

    try {
      loaded = await loadMcpTools(project, options)
      expect(loaded.tools.map(tool => tool.name)).toEqual(['fixture__probe'])
      expect(loaded.warnings?.some(warning => warning.includes('schema cache could not be saved'))).toBe(true)
      await expect(loaded.tools[0]!.execute({})).resolves.toContain('tool was called')
    } finally {
      await loaded?.cleanup?.()
      saveSchemas.mockRestore()
    }
  }, 15_000)

  sandboxTest('keeps live tools and approval when the discovered catalog exceeds the cache byte budget', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-mcp-lazy-cache-oversized-catalog-'))
    roots.push(root)
    const project = join(root, 'project')
    const trustFile = join(root, 'trust.json')
    await mkdir(join(project, '.deepseek'), { recursive: true })
    await writeFile(join(project, '.deepseek', 'mcp.json'), JSON.stringify({
      servers: { fixture: { transport: 'stdio', command: process.execPath, args: ['-e', 'process.exit(0)'] } },
    }))

    const options = { enabled: true, trustFile, initialTimeoutMs: 5_000 }
    const pending = await loadMcpTools(project, options)
    expect(pending.approval).toBeDefined()
    await approveMcpConfig(project, pending.approval!, trustFile)
    const trust = new WorkspaceTrustStore(project, trustFile)
    const connect = spyOn(Client.prototype, 'connect').mockImplementation(async () => undefined as never)
    const listTools = spyOn(Client.prototype, 'listTools').mockResolvedValue({
      tools: [{ name: 'large-schema', description: 'x'.repeat(1_048_576), inputSchema: { type: 'object' } }],
    } as never)
    const close = spyOn(Client.prototype, 'close').mockImplementation(async () => undefined as never)
    let loaded: Awaited<ReturnType<typeof loadMcpTools>> | undefined

    try {
      loaded = await loadMcpTools(project, options)
      expect(loaded.tools.map(tool => tool.name)).toEqual(['fixture__large-schema'])
      expect(loaded.warnings?.some(warning => warning.includes('schema cache optimization was skipped') && warning.includes('byte limit'))).toBe(true)
      expect(await trust.isMcpApproved(pending.approval!)).toBe(true)
      expect(await trust.getMcpSchemas(pending.approval!)).toBeNull()
      expect(connect).toHaveBeenCalledTimes(1)
      expect(listTools).toHaveBeenCalledTimes(1)
    } finally {
      await loaded?.cleanup?.()
      connect.mockRestore()
      listTools.mockRestore()
      close.mockRestore()
    }
  }, 15_000)

  sandboxTest('handles server names that collide with Object.prototype in partial caches', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-mcp-lazy-cache-prototype-'))
    roots.push(root)
    const project = join(root, 'project')
    const trustFile = join(root, 'trust.json')
    await mkdir(join(project, '.deepseek'), { recursive: true })
    const script = `
let buffer = ''
function reply(id, result) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\\n') }
process.stdin.setEncoding('utf8')
process.stdin.on('data', chunk => {
  buffer += chunk
  let end
  while ((end = buffer.indexOf('\\n')) >= 0) {
    const line = buffer.slice(0, end); buffer = buffer.slice(end + 1)
    if (!line) continue
    const request = JSON.parse(line)
    if (request.id === undefined) continue
    if (request.method === 'initialize') reply(request.id, { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'prototype-fixture', version: '1.0' } })
    else if (request.method === 'tools/list') reply(request.id, { tools: [{ name: 'probe', description: 'probe', inputSchema: { type: 'object', properties: {} } }] })
  }
})
`
    const server = { transport: 'stdio', command: process.execPath, args: ['-e', script] }
    await writeFile(join(project, '.deepseek', 'mcp.json'), JSON.stringify({
      servers: { fixture: server, constructor: server, ['__proto__']: server },
    }))

    const options = { enabled: true, trustFile, initialTimeoutMs: 5_000 }
    const pending = await loadMcpTools(project, options)
    expect(pending.approval).toBeDefined()
    await approveMcpConfig(project, pending.approval!, trustFile)

    const trust = new WorkspaceTrustStore(project, trustFile)
    expect(await trust.saveMcpSchemas(pending.approval!, {
      fixture: [{ name: 'cached', inputSchema: { type: 'object', properties: {} } }],
    })).toBe(true)

    const partial = await loadMcpTools(project, options)
    try {
      expect(partial.errors).toEqual([])
      expect(partial.tools.map(tool => tool.name)).toEqual([
        'fixture__cached',
        'constructor__probe',
        '__proto____probe',
      ])
      const cached = await trust.getMcpSchemas(pending.approval!)
      expect(cached && Object.prototype.hasOwnProperty.call(cached, '__proto__')).toBe(true)
    } finally {
      await partial.cleanup?.()
    }

    const warm = await loadMcpTools(project, options)
    try {
      expect(warm.errors).toEqual([])
      expect(warm.tools.map(tool => tool.name)).toEqual([
        'fixture__cached',
        'constructor__probe',
        '__proto____probe',
      ])
    } finally {
      await warm.cleanup?.()
    }
  }, 15_000)

  sandboxTest('does not start a server when cleanup wins the initial approval check', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-mcp-lazy-cache-cleanup-race-'))
    roots.push(root)
    const project = join(root, 'project')
    const trustFile = join(root, 'trust.json')
    await mkdir(join(project, '.deepseek'), { recursive: true })
    const script = `
let buffer = ''
function reply(id, result) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\\n') }
process.stdin.setEncoding('utf8')
process.stdin.on('data', chunk => {
  buffer += chunk
  let end
  while ((end = buffer.indexOf('\\n')) >= 0) {
    const line = buffer.slice(0, end); buffer = buffer.slice(end + 1)
    if (!line) continue
    const request = JSON.parse(line)
    if (request.id === undefined) continue
    if (request.method === 'initialize') reply(request.id, { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'cleanup-race-fixture', version: '1.0' } })
    else if (request.method === 'tools/list') reply(request.id, { tools: [{ name: 'probe', description: 'probe', inputSchema: { type: 'object' } }] })
    else if (request.method === 'tools/call') reply(request.id, { content: [{ type: 'text', text: 'unexpected tool call' }] })
  }
})
`
    await writeFile(join(project, '.deepseek', 'mcp.json'), JSON.stringify({
      servers: { fixture: { transport: 'stdio', command: process.execPath, args: ['-e', script] } },
    }))

    const options = { enabled: true, trustFile, initialTimeoutMs: 5_000 }
    const pending = await loadMcpTools(project, options)
    await approveMcpConfig(project, pending.approval!, trustFile)
    const cold = await loadMcpTools(project, options)
    await cold.cleanup?.()
    const warm = await loadMcpTools(project, options)

    let markApprovalCheckPaused!: () => void
    const approvalCheckPaused = new Promise<void>(resolve => { markApprovalCheckPaused = resolve })
    let releaseApprovalCheck!: () => void
    const approvalCheckGate = new Promise<void>(resolve => { releaseApprovalCheck = resolve })
    let pauseNextApprovalCheck = true
    const originalIsMcpApproved = WorkspaceTrustStore.prototype.isMcpApproved
    const approvalCheck = spyOn(WorkspaceTrustStore.prototype, 'isMcpApproved').mockImplementation(async function (this: WorkspaceTrustStore, artifact) {
      const approved = await originalIsMcpApproved.call(this, artifact)
      if (pauseNextApprovalCheck) {
        pauseNextApprovalCheck = false
        markApprovalCheckPaused()
        await approvalCheckGate
      }
      return approved
    })
    const connect = spyOn(Client.prototype, 'connect').mockImplementation(async () => undefined as never)
    const listTools = spyOn(Client.prototype, 'listTools').mockResolvedValue({ tools: [{ name: 'probe', description: 'probe', inputSchema: { type: 'object' } }] } as never)
    const callTool = spyOn(Client.prototype, 'callTool').mockResolvedValue({ content: [{ type: 'text', text: 'unexpected tool call' }] } as never)
    let execution: Promise<unknown> | undefined

    try {
      execution = warm.tools[0]!.execute({})
      await approvalCheckPaused
      await warm.cleanup?.()
      releaseApprovalCheck()
      await expect(execution).rejects.toThrow('has been closed')
      expect(connect).not.toHaveBeenCalled()
      expect(listTools).not.toHaveBeenCalled()
      expect(callTool).not.toHaveBeenCalled()
    } finally {
      releaseApprovalCheck()
      await warm.cleanup?.()
      await execution?.catch(() => undefined)
      approvalCheck.mockRestore()
      connect.mockRestore()
      listTools.mockRestore()
      callTool.mockRestore()
    }
  }, 15_000)

  it('keeps approved live tools available when invalidating another source cache fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-mcp-cache-invalidation-failure-'))
    roots.push(root)
    const project = join(root, 'project')
    const plugins = join(root, 'plugins')
    const plugin = join(plugins, 'untrusted-plugin')
    const trustFile = join(root, 'trust.json')
    const previousPluginsDir = process.env.DEEPSEEK_PLUGINS_DIR
    await mkdir(join(project, '.deepseek'), { recursive: true })
    await mkdir(plugin, { recursive: true })
    await writeFile(join(project, '.deepseek', 'mcp.json'), JSON.stringify({
      servers: { healthy: { transport: 'http', url: 'http://127.0.0.1:1/mcp' } },
    }))
    await writeFile(join(plugins, 'registry.json'), JSON.stringify({ version: 1, plugins: { 'untrusted-plugin': { name: 'untrusted-plugin' } } }))
    await writeFile(join(plugin, 'plugin.json'), JSON.stringify({ name: 'untrusted-plugin', mcpServers: 'mcp.json' }))
    await writeFile(join(plugin, 'mcp.json'), JSON.stringify({
      servers: { blocked: { transport: 'http', url: 'http://127.0.0.1:2/mcp' } },
    }))

    const options = { enabled: true, trustFile }
    let loaded: Awaited<ReturnType<typeof loadMcpTools>> | undefined
    const connect = spyOn(Client.prototype, 'connect').mockImplementation(async () => undefined as never)
    const listTools = spyOn(Client.prototype, 'listTools').mockResolvedValue({
      tools: [{ name: 'probe', description: 'probe', inputSchema: { type: 'object' } }],
    } as never)
    const callTool = spyOn(Client.prototype, 'callTool').mockResolvedValue({
      content: [{ type: 'text', text: 'healthy tool called' }],
    } as never)
    const invalidate = spyOn(WorkspaceTrustStore.prototype, 'invalidateMcpSchemas').mockImplementation(async artifact => {
      if (artifact.canonicalPath === await realpath(join(plugin, 'mcp.json'))) throw new Error('fixture cache storage unavailable')
    })

    try {
      process.env.DEEPSEEK_PLUGINS_DIR = plugins
      const pending = await loadMcpTools(project, options)
      expect(pending.approval).toBeDefined()
      await approveMcpConfig(project, pending.approval!, trustFile)

      loaded = await loadMcpTools(project, options)
      expect(loaded.tools.map(tool => tool.name)).toEqual(['healthy__probe'])
      expect(loaded.approval?.canonicalPath).toBe(await realpath(join(plugin, 'mcp.json')))
      expect(loaded.warnings?.some(warning => warning.includes('approval is still required') && warning.includes('fixture cache storage unavailable'))).toBe(true)
      await expect(loaded.tools[0]!.execute({})).resolves.toBe('healthy tool called')
    } finally {
      await loaded?.cleanup?.()
      invalidate.mockRestore()
      connect.mockRestore()
      listTools.mockRestore()
      callTool.mockRestore()
      if (previousPluginsDir === undefined) delete process.env.DEEPSEEK_PLUGINS_DIR
      else process.env.DEEPSEEK_PLUGINS_DIR = previousPluginsDir
    }
  })

  it('shares an in-flight cleanup promise across concurrent callers', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-mcp-cleanup-idempotency-'))
    roots.push(root)
    const project = join(root, 'project')
    const trustFile = join(root, 'trust.json')
    await mkdir(join(project, '.deepseek'), { recursive: true })
    await writeFile(join(project, '.deepseek', 'mcp.json'), JSON.stringify({
      servers: { fixture: { transport: 'http', url: 'http://127.0.0.1:3/mcp' } },
    }))

    const options = { enabled: true, trustFile }
    const connect = spyOn(Client.prototype, 'connect').mockImplementation(async () => undefined as never)
    const listTools = spyOn(Client.prototype, 'listTools').mockResolvedValue({
      tools: [{ name: 'probe', inputSchema: { type: 'object' } }],
    } as never)
    let markCloseStarted!: () => void
    const closeStarted = new Promise<void>(resolve => { markCloseStarted = resolve })
    let releaseClose!: () => void
    const closeGate = new Promise<void>(resolve => { releaseClose = resolve })
    const close = spyOn(Client.prototype, 'close').mockImplementation(async () => {
      markCloseStarted()
      await closeGate
    })
    let loaded: Awaited<ReturnType<typeof loadMcpTools>> | undefined

    try {
      const pending = await loadMcpTools(project, options)
      await approveMcpConfig(project, pending.approval!, trustFile)
      loaded = await loadMcpTools(project, options)
      const cleanup = loaded.cleanup!
      const first = cleanup()
      await closeStarted
      let secondSettled = false
      const second = cleanup().then(() => { secondSettled = true })
      await Promise.resolve()
      expect(secondSettled).toBe(false)

      releaseClose()
      await Promise.all([first, second])
      expect(close).toHaveBeenCalledTimes(1)
    } finally {
      releaseClose()
      await loaded?.cleanup?.()
      close.mockRestore()
      connect.mockRestore()
      listTools.mockRestore()
    }
  })
})
