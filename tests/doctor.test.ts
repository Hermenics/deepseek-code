import { afterEach, describe, expect, it } from 'bun:test'
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { approveMcpConfig, loadMcpTools } from '../src/agent/mcp.js'
import { checkMcpCatalog } from '../src/commands/doctor/mcp.js'
import { classifyProviderError, formatProviderProbe, probeProviderCatalog, selectDoctorProviderProfile } from '../src/commands/doctor/provider.js'
import { sandboxAvailable } from '../src/utils/platform.js'

const roots: string[] = []
const sandboxTest = it.skipIf(!sandboxAvailable())
const previousPluginsDir = process.env.DEEPSEEK_PLUGINS_DIR

afterEach(async () => {
  if (previousPluginsDir === undefined) delete process.env.DEEPSEEK_PLUGINS_DIR
  else process.env.DEEPSEEK_PLUGINS_DIR = previousPluginsDir
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('doctor provider catalog probe', () => {
  it('reports catalog reachability without exposing the key or claiming inference permission', async () => {
    const result = await probeProviderCatalog(
      { provider: 'deepseek', apiKey: 'doctor-secret', baseURL: 'https://proxy.example/v1' },
      { fetchImpl: async (_url, init) => {
        expect(new Headers(init?.headers).get('authorization')).toBe('Bearer doctor-secret')
        return new Response(JSON.stringify({ data: [{ id: 'model-a' }, { id: 'model-b' }] }), { status: 200 })
      } },
    )

    expect(result).toEqual({ provider: 'deepseek', status: 'ok', modelCount: 2 })
    const formatted = formatProviderProbe(result)
    expect(formatted.detail).toContain('does not confirm inference permission')
    expect(formatted.detail).not.toContain('doctor-secret')
    expect(formatted.detail).not.toContain('proxy.example')
  })

  it('refuses to send a provider key over HTTP to a remote endpoint', async () => {
    let requested = false
    const result = await probeProviderCatalog(
      { provider: 'deepseek', apiKey: 'remote-secret', baseURL: 'http://proxy.example/v1' },
      { fetchImpl: async () => {
        requested = true
        return new Response(JSON.stringify({ data: [{ id: 'model-a' }] }), { status: 200 })
      } },
    )

    expect(requested).toBe(false)
    expect(result.status).toBe('configuration-error')
    expect(formatProviderProbe(result).detail).not.toContain('remote-secret')
  })

  it('allows loopback HTTP endpoints and refuses schemeless remote URLs', async () => {
    const local = await probeProviderCatalog(
      { provider: 'deepseek', apiKey: 'local-secret', baseURL: 'localhost:8000/v1' },
      { fetchImpl: async (input, init) => {
        expect(String(input)).toBe('http://localhost:8000/v1/models')
        expect(new Headers(init?.headers).get('authorization')).toBe('Bearer local-secret')
        return new Response(JSON.stringify({ data: [{ id: 'local-model' }] }), { status: 200 })
      } },
    )
    let requested = false
    const schemeless = await probeProviderCatalog(
      { provider: 'deepseek', apiKey: 'remote-secret', baseURL: 'proxy.example/v1' },
      { fetchImpl: async input => {
        requested = true
        return new Response(JSON.stringify({ data: [{ id: 'remote-model' }] }), { status: 200 })
      } },
    )

    expect(local.status).toBe('ok')
    expect(schemeless.status).toBe('configuration-error')
    expect(requested).toBe(false)
  })

  it('does not fall back to another profile when the active profile id is stale', () => {
    const profiles = [
      { id: 'first', name: 'First', provider: 'deepseek' as const, apiKey: 'first-secret' },
      { id: 'second', name: 'Second', provider: 'deepseek' as const, apiKey: 'second-secret' },
    ]

    expect(selectDoctorProviderProfile(profiles, 'second')).toEqual(profiles[1])
    expect(selectDoctorProviderProfile(profiles)).toEqual(profiles[0])
    expect(() => selectDoctorProviderProfile(profiles, 'deleted-profile')).toThrow('Active provider profile is unavailable')
  })

  it('distinguishes authentication, network and timeout failures', async () => {
    const config = { provider: 'deepseek' as const, apiKey: 'secret' }
    const auth = await probeProviderCatalog(config, { fetchImpl: async () => new Response('', { status: 401 }) })
    const network = await probeProviderCatalog(config, { fetchImpl: async () => { throw new TypeError('fetch failed') } })
    const timeout = await probeProviderCatalog(config, {
      timeoutMs: 10,
      fetchImpl: async (_url, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
      }),
    })

    expect(auth.status).toBe('authentication-error')
    expect(network.status).toBe('network-error')
    expect(timeout.status).toBe('timeout')
    expect(classifyProviderError(Object.assign(new Error('denied'), { status: 403 }))).toBe('authentication-error')
    expect(classifyProviderError(new Error('request failed', { cause: { code: 'ETIMEDOUT' } }))).toBe('timeout')
    expect(classifyProviderError(new Error('No models were returned by bedrock; check its connection, credentials, and catalog access.'))).toBe('service-error')
    expect(classifyProviderError(Object.assign(new Error('service account file unavailable'), { code: 'ENOENT' }))).toBe('configuration-error')
    expect(classifyProviderError(Object.assign(new Error('OAuth credentials rejected'), { code: 'invalid_grant' }))).toBe('authentication-error')
  })

  it('classifies native provider failures without printing raw credential details', async () => {
    const result = await probeProviderCatalog(
      { provider: 'bedrock', awsRegion: 'us-east-1' },
      { probes: { bedrock: async () => { throw Object.assign(new Error('secret-profile access denied'), { $metadata: { httpStatusCode: 403 } }) } } },
    )

    expect(result.status).toBe('authentication-error')
    const formatted = formatProviderProbe(result)
    expect(formatted.detail).toContain('provider rejected authentication')
    expect(formatted.detail).not.toContain('secret-profile')
  })

  it('checks the Vertex catalog with the configured location and does not expose its token', async () => {
    const result = await probeProviderCatalog({
      provider: 'vertex',
      gcpProject: 'fixture-project',
      gcpLocation: 'us-central1',
      gcpCredentials: '/private/service-account.json',
    }, {
      vertexTokenProvider: async path => {
        expect(path).toBe('/private/service-account.json')
        return 'vertex-secret'
      },
      fetchImpl: async (input, init) => {
        expect(String(input)).toBe('https://us-central1-aiplatform.googleapis.com/v1beta1/publishers/deepseek-ai/models')
        expect(new Headers(init?.headers).get('authorization')).toBe('Bearer vertex-secret')
        return new Response(JSON.stringify({ publisherModels: [{ name: 'publishers/deepseek-ai/models/deepseek-r1' }] }), { status: 200 })
      },
    })

    expect(result).toEqual({ provider: 'vertex', status: 'ok', modelCount: 1 })
    const formatted = formatProviderProbe(result)
    expect(formatted.detail).toContain('does not confirm inference permission')
    expect(formatted.detail).not.toContain('vertex-secret')
    expect(formatted.detail).not.toContain('/private/service-account.json')
  })

  it('treats a missing configured local model as a configuration issue', async () => {
    const result = await probeProviderCatalog(
      { provider: 'local', localBaseUrl: 'http://localhost:11434/v1', localModel: 'fixture-model' },
      { probes: { local: async () => ['other-model'] } },
    )

    expect(result.status).toBe('configuration-error')
    expect(formatProviderProbe(result).detail).toContain('provider configuration is incomplete')
  })
})

describe('doctor MCP catalog check', () => {
  it('does not start an MCP server whose configuration is still awaiting approval', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-doctor-mcp-'))
    roots.push(root)
    process.env.DEEPSEEK_PLUGINS_DIR = join(root, 'plugins')
    await mkdir(join(root, '.deepseek'), { recursive: true })
    const marker = join(root, 'server-started')
    const trustFile = join(root, 'trust.json')
    await writeFile(join(root, '.deepseek', 'mcp.json'), JSON.stringify({
      servers: { pending: { transport: 'stdio', command: process.execPath, args: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'started')`] } },
    }))

    const result = await checkMcpCatalog(root, true, { trustFile, initialTimeoutMs: 500 })

    expect(result).toMatchObject({ ok: false, detail: '0 tools listed from approved MCP configurations; unapproved configuration skipped' })
    await expect(access(marker)).rejects.toThrow()
  })

  it('skips every MCP server when the user setting is disabled', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-doctor-mcp-disabled-'))
    roots.push(root)
    const result = await checkMcpCatalog(root, false)
    expect(result).toEqual({ name: 'MCP catalog', ok: true, detail: 'MCP is disabled; no servers were started' })
  })

  sandboxTest('lists tools from approved configurations without calling them', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-doctor-mcp-approved-'))
    roots.push(root)
    process.env.DEEPSEEK_PLUGINS_DIR = join(root, 'plugins')
    await mkdir(join(root, '.deepseek'), { recursive: true })
    const callMarker = join(root, 'tool-called')
    const script = `let buffer = ''
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
    if (request.method === 'initialize') reply(request.id, { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'doctor-fixture', version: '1.0' } })
    else if (request.method === 'tools/list') reply(request.id, { tools: [{ name: 'read', inputSchema: { type: 'object', properties: {} } }] })
    else if (request.method === 'tools/call') require('node:fs').writeFileSync(${JSON.stringify(callMarker)}, 'called')
  }
})`
    await writeFile(join(root, '.deepseek', 'mcp.json'), JSON.stringify({
      servers: { fixture: { transport: 'stdio', command: process.execPath, args: ['-e', script] } },
    }))
    const trustFile = join(root, 'workspace-trust.json')
    const pending = await loadMcpTools(root, { enabled: true, trustFile, initialTimeoutMs: 5_000 })
    expect(pending.approval).toBeDefined()
    await pending.cleanup?.()
    await approveMcpConfig(root, pending.approval!, trustFile)

    const result = await checkMcpCatalog(root, true, { trustFile, initialTimeoutMs: 5_000 })

    expect(result).toEqual({ name: 'MCP catalog', ok: true, detail: '1 tool listed from approved MCP configurations' })
    await expect(access(callMarker)).rejects.toThrow()
  })
})
