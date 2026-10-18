import { describe, expect, it } from 'bun:test'
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { approveMcpConfig, loadMcpTools } from '../src/agent/mcp.js'
import { sandboxAvailable } from '../src/utils/platform.js'

const sandboxTest = it.skipIf(!sandboxAvailable())
const noSandboxTest = it.skipIf(sandboxAvailable())

async function makeProject(): Promise<{ root: string; project: string; trustFile: string }> {
  const root = await mkdtemp(join(tmpdir(), 'deepseek-mcp-sandbox-'))
  const project = join(root, 'project')
  const trustFile = join(root, 'trust.json')
  await mkdir(join(project, '.deepseek'), { recursive: true })
  return { root, project, trustFile }
}

async function loadApprovedServer(root: string, trustFile: string) {
  const pending = await loadMcpTools(root, { enabled: true, trustFile, initialTimeoutMs: 5000 })
  expect(pending.approval).toBeDefined()
  await approveMcpConfig(root, pending.approval!, trustFile)
  return loadMcpTools(root, { enabled: true, trustFile, initialTimeoutMs: 5000 })
}

async function listenOnLoopback(): Promise<{ server: ReturnType<typeof createServer>; port: number }> {
  const server = createServer(socket => socket.end('host network reachable'))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Failed to start loopback fixture')
  return { server, port: address.port }
}

describe('MCP stdio process sandbox', () => {
  noSandboxTest('fails closed before launching stdio servers when bubblewrap is unavailable', async () => {
    const { root, project, trustFile } = await makeProject()
    const marker = join(root, 'started.txt')
    try {
      await writeFile(join(project, '.deepseek', 'mcp.json'), JSON.stringify({
        servers: { fixture: { transport: 'stdio', command: process.execPath, args: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'started')`] } },
      }))
      const loaded = await loadApprovedServer(project, trustFile)
      expect(loaded.tools).toHaveLength(0)
      expect(loaded.errors.join('\n')).toContain('require a working Linux bubblewrap sandbox')
      await expect(access(marker)).rejects.toThrow()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  sandboxTest('keeps workspace writes and host network access outside stdio servers', async () => {
    const { root, project, trustFile } = await makeProject()
    const outsideMarker = join(root, 'outside.txt')
    const workspaceMarker = join(project, 'inside.txt')
    const { server, port } = await listenOnLoopback()
    const script = `
const fs = require('node:fs')
const net = require('node:net')
const outside = ${JSON.stringify(outsideMarker)}
const inside = ${JSON.stringify(workspaceMarker)}
const port = ${port}
let buffer = ''
function reply(id, result) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\\n') }
function probeNetwork() {
  return new Promise(resolve => {
    const socket = net.createConnection({ host: '127.0.0.1', port })
    const finish = reachable => { socket.destroy(); resolve(reachable ? 'reachable' : 'blocked') }
    socket.setTimeout(500, () => finish(false))
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
  })
}
process.stdin.setEncoding('utf8')
process.stdin.on('data', chunk => {
  buffer += chunk
  let end
  while ((end = buffer.indexOf('\\n')) >= 0) {
    const line = buffer.slice(0, end); buffer = buffer.slice(end + 1)
    if (!line) continue
    const request = JSON.parse(line)
    if (request.id === undefined) continue
    if (request.method === 'initialize') reply(request.id, { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'sandbox-fixture', version: '1.0' } })
    else if (request.method === 'tools/list') reply(request.id, { tools: [{ name: 'probe', inputSchema: { type: 'object', properties: {} } }] })
    else if (request.method === 'tools/call') {
      try { fs.writeFileSync(outside, 'escaped') } catch {}
      try { fs.writeFileSync(inside, 'escaped') } catch {}
      probeNetwork().then(network => reply(request.id, { content: [{ type: 'text', text: JSON.stringify({ network }) }] }))
    }
  }
})
`
    let cleanup: (() => Promise<void>) | undefined
    try {
      await writeFile(join(project, '.deepseek', 'mcp.json'), JSON.stringify({
        servers: { fixture: { transport: 'stdio', command: process.execPath, args: ['-e', script] } },
      }))
      const loaded = await loadApprovedServer(project, trustFile)
      cleanup = loaded.cleanup
      expect(loaded.errors).toEqual([])
      expect(loaded.tools.map(tool => tool.name)).toEqual(['fixture__probe'])
      expect(JSON.parse(await loaded.tools[0]!.execute({}))).toEqual({ network: 'blocked' })
      await expect(access(outsideMarker)).rejects.toThrow()
      await expect(access(workspaceMarker)).rejects.toThrow()
    } finally {
      await cleanup?.()
      await new Promise<void>(resolve => server.close(() => resolve()))
      await rm(root, { recursive: true, force: true })
    }
  }, 30_000)

  sandboxTest('closes a stdio sandbox whose server ignores stdin EOF', async () => {
    const { root, project, trustFile } = await makeProject()
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
    if (request.method === 'initialize') reply(request.id, { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'hanging-fixture', version: '1.0' } })
    else if (request.method === 'tools/list') reply(request.id, { tools: [] })
  }
})
process.stdin.on('end', () => {})
setInterval(() => {}, 1000)
`
    let cleanup: (() => Promise<void>) | undefined
    try {
      await writeFile(join(project, '.deepseek', 'mcp.json'), JSON.stringify({
        servers: { fixture: { transport: 'stdio', command: process.execPath, args: ['-e', script] } },
      }))
      const loaded = await loadApprovedServer(project, trustFile)
      cleanup = loaded.cleanup
      expect(loaded.errors).toEqual([])
      const started = Date.now()
      await cleanup?.()
      cleanup = undefined
      expect(Date.now() - started).toBeLessThan(5000)
    } finally {
      await cleanup?.()
      await rm(root, { recursive: true, force: true })
    }
  }, 30_000)
})
