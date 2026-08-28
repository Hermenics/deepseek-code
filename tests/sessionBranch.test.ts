import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { branchSession, clearSessions, listSessions, saveSession, type SessionData } from '../src/agent/session.js'

const roots: string[] = []

afterEach(async () => {
  const pending = roots.splice(0)
  for (const root of pending) {
    await clearSessions('project', root)
    await rm(root, { recursive: true, force: true })
  }
})

describe('session branching', () => {
  it('persists a deep independent copy and retains the original identity', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'deepseek-branch-'))
    roots.push(cwd)
    const source: SessionData = {
      id: '0123456789ab', title: 'Original', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      cwd, model: 'deepseek-v4-flash', provider: 'deepseek', language: 'pt-BR', activeAgent: null,
      agentMessages: [{ role: 'user', content: 'keep this' }], uiMessages: [{ role: 'user', content: 'keep this' }], filesModified: ['src/a.ts'],
    }

    await saveSession(source)
    const branch = await branchSession(source.id, cwd, 'Auth experiment')
    branch.agentMessages[0] = { role: 'user', content: 'changed branch' }
    branch.filesModified.push('src/b.ts')

    expect(branch.id).not.toBe(source.id)
    expect(branch.parentSessionId).toBe(source.id)
    expect(branch.title).toBe('Branch of Auth experiment')
    expect(source.agentMessages[0]).toEqual({ role: 'user', content: 'keep this' })
    expect(source.filesModified).toEqual(['src/a.ts'])
    expect((await listSessions(cwd)).some(session => session.id === branch.id)).toBe(true)
    expect((await listSessions(cwd)).some(session => session.id === source.id)).toBe(true)
  })
})
