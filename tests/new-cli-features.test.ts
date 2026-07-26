import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { loadAgentsMd } from '../src/agent/steering.js'
import { detectVerificationCommand } from '../src/agent/verify.js'
import { exportSession, formatSessionExport, type SessionData } from '../src/agent/session.js'
import { parseSessionsCommand } from '../src/commands/sessions/index.js'
import { parseCatalogCommand } from '../src/commands/catalog/index.js'
import { parseCommand } from '../src/commands.js'
import { formatDoctorReport } from '../src/doctor.js'
import { formatCatalog } from '../src/catalog.js'
import { findLspServer, frameLspMessage } from '../src/lsp.js'
import { validateSettings } from '../src/settings/repository.js'

const temporary: string[] = []
async function directory(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), 'deepseek-feature-test-'))
  temporary.push(value)
  return value
}
afterEach(async () => { await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true }))) })

describe('new CLI features', () => {
  it('loads root AGENTS.md without making it a DeepSeek-only file', async () => {
    const cwd = await directory()
    await writeFile(join(cwd, 'AGENTS.md'), 'Use bun test.\n', 'utf8')
    expect(await loadAgentsMd(cwd)).toBe('Use bun test.')
    expect(await loadAgentsMd(join(cwd, 'missing'))).toBe('')
  })

  it('detects an existing test script and never guesses one', async () => {
    const cwd = await directory()
    expect(await detectVerificationCommand(cwd)).toBeNull()
    await writeFile(join(cwd, 'package.json'), JSON.stringify({ scripts: { test: 'vitest run' } }), 'utf8')
    expect(await detectVerificationCommand(cwd)).toEqual({ command: 'npm', args: ['test'], display: 'npm test' })
  })

  it('exports session transcript with secrets redacted in JSON and Markdown', () => {
    const session: SessionData = {
      id: 'abc', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', cwd: '/work', model: 'model', provider: 'deepseek', language: null, activeAgent: null,
      agentMessages: [], filesModified: [], uiMessages: [{ role: 'user', content: 'token=sk-abcdefghijklmnop' }],
    }
    expect(formatSessionExport(session, 'json')).toContain('[REDACTED]')
    expect(formatSessionExport(session, 'md')).toContain('# DeepSeek Code session')
    expect(formatSessionExport(session, 'md')).not.toContain('sk-abcdefghijklmnop')
  })

  it('parses explicit session exports and all new slash commands', () => {
    expect(parseSessionsCommand(['export', 'a1b2c3d4e5f6', 'json'])).toEqual({ type: 'sessions', action: 'export', id: 'a1b2c3d4e5f6', format: 'json' })
    expect(parseSessionsCommand(['export']).type).toBe('unknown')
    expect(parseCommand('/doctor')).toEqual({ type: 'doctor' })
    expect(parseCommand('/verify')).toEqual({ type: 'verify' })
    expect(parseCatalogCommand(['mcp'])).toEqual({ type: 'catalog', kind: 'MCP' })
  })

  it('rejects session export IDs that could escape the export directory', async () => {
    await expect(exportSession('../outside', 'json')).rejects.toThrow('Invalid session ID')
  })

  it('formats doctor and catalog reports without contacting external services', () => {
    expect(formatDoctorReport({ cwd: '/work', checks: [{ name: 'Git', ok: true, detail: 'available' }] })).toContain('✓ Git')
    expect(formatCatalog('MCP')).toContain('GitHub')
    expect(formatCatalog('MCP')).not.toContain('OpenAI docs')
  })

  it('selects only a configured language server matching a file extension', () => {
    const settings = { lsp: { servers: [{ name: 'TypeScript', command: 'typescript-language-server', args: ['--stdio'], extensions: ['.ts'] }] } }
    expect(findLspServer(settings, '/work/src/app.ts')?.name).toBe('TypeScript')
    expect(findLspServer(settings, '/work/src/app.py')).toBeNull()
  })

  it('validates LSP server shape before it can run', () => {
    const issues = validateSettings({ lsp: { servers: [{ name: '', command: '', extensions: ['ts'] }] } })
    expect(issues.map(issue => issue.path)).toEqual(expect.arrayContaining(['lsp.servers.0.name', 'lsp.servers.0.command', 'lsp.servers.0.extensions']))
  })

  it('frames JSON-RPC messages with an exact byte length', () => {
    const framed = frameLspMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
    const [header, body] = framed.toString('utf8').split('\r\n\r\n')
    expect(header).toBe(`Content-Length: ${Buffer.byteLength(body!)}`)
    expect(JSON.parse(body!)).toMatchObject({ id: 1, method: 'initialize' })
  })
})
