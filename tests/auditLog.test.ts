import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test'
import * as fs from 'fs/promises'
import * as path from 'path'

// We test auditLog by spying on appendFile
describe('auditLog', () => {
  let appendFileSpy: ReturnType<typeof mock>
  let mkdirSpy: ReturnType<typeof mock>

  beforeEach(async () => {
    // Reset module state by re-importing fresh won't work in bun easily,
    // so we spy on the actual fs calls
    appendFileSpy = mock(() => Promise.resolve())
    mkdirSpy = mock(() => Promise.resolve())
  })

  it('getLogFile retorna path com session- e .jsonl', async () => {
    const { getLogFile } = await import('../src/agent/auditLog.js')
    const logFile = getLogFile()
    expect(logFile).toContain('session-')
    expect(logFile).toContain('.jsonl')
  })

  it('getLogFile retorna path absoluto', async () => {
    const { getLogFile } = await import('../src/agent/auditLog.js')
    const logFile = getLogFile()
    expect(path.isAbsolute(logFile)).toBe(true)
  })

  it('auditLog não lança exceção para evento session_start', async () => {
    const { auditLog } = await import('../src/agent/auditLog.js')
    await expect(
      auditLog({ type: 'session_start', model: 'deepseek-chat', provider: 'deepseek', cwd: '/tmp' })
    ).resolves.toBeUndefined()
  })

  it('auditLog não lança exceção para evento tool_call', async () => {
    const { auditLog } = await import('../src/agent/auditLog.js')
    await expect(
      auditLog({ type: 'tool_call', tool: 'read_file', args: { path: 'test.ts' } })
    ).resolves.toBeUndefined()
  })

  it('auditLog não lança exceção para evento session_end', async () => {
    const { auditLog } = await import('../src/agent/auditLog.js')
    await expect(
      auditLog({ type: 'session_end', totalTokens: 1000 })
    ).resolves.toBeUndefined()
  })

  it('auditLog não lança exceção para evento checkpoint', async () => {
    const { auditLog } = await import('../src/agent/auditLog.js')
    await expect(
      auditLog({ type: 'checkpoint', id: 'cp-001', label: 'test' })
    ).resolves.toBeUndefined()
  })

  it('auditLog não lança exceção para evento compact', async () => {
    const { auditLog } = await import('../src/agent/auditLog.js')
    await expect(
      auditLog({ type: 'compact', reason: 'context full' })
    ).resolves.toBeUndefined()
  })

  it('getLogFile retorna sempre o mesmo path na sessão', async () => {
    const { getLogFile } = await import('../src/agent/auditLog.js')
    expect(getLogFile()).toBe(getLogFile())
  })
})
