import { describe, expect, it } from 'bun:test'
import type { SessionData } from '../../../src/agent/session.js'
import { buildRows, displayCwd, filterCounts, liveStatus, relativeAge, visibleRows } from '../../../src/ui/agents/overview.js'

const session = (id: string, over: Partial<SessionData> = {}): SessionData => ({
  id, createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z', cwd: '/w/a', model: 'deepseek-v4', provider: 'deepseek',
  language: null, activeAgent: null, agentMessages: [], uiMessages: [], filesModified: [], ...over,
})

describe('command center rules (Codex agents overview)', () => {
  it('classifies the live session: waiting on the user beats running work, subagents roll up', () => {
    expect(liveStatus({ loading: true, waitingOnUser: true, subagents: [] })).toBe('needs')
    expect(liveStatus({ loading: false, waitingOnUser: false, subagents: ['blocked'] })).toBe('needs')
    expect(liveStatus({ loading: false, waitingOnUser: false, subagents: ['running'] })).toBe('working')
    expect(liveStatus({ loading: true, waitingOnUser: false, subagents: [] })).toBe('working')
    expect(liveStatus({ loading: false, waitingOnUser: false, subagents: ['done'] })).toBe('ready')
  })

  it('lists the live session once as current and every saved one as Inactive', () => {
    const rows = buildRows(
      [session('aaa', { title: 'stale copy' }), session('bbb', { uiMessages: [{ role: 'user', content: 'Fix login\nmore' }, { role: 'assistant', content: 'done' }] })],
      { session: session('aaa', { title: 'Live title' }), status: 'working' },
    )
    expect(rows.map(row => [row.id, row.title, row.status, row.current])).toEqual([
      ['aaa', 'Live title', 'working', true],
      ['bbb', 'Fix login', 'inactive', false],
    ])
    expect(rows[1]!.lastMessage).toBe('done')
    expect(filterCounts(rows)).toEqual({ all: 2, needs: 0, working: 1, ready: 0, inactive: 1 })
  })

  it('filters by tab and search and keeps each group contiguous, newest first', () => {
    const rows = buildRows([
      session('old', { cwd: '/w/b', title: 'Old', updatedAt: '2026-09-01T00:00:00Z' }),
      session('new', { cwd: '/w/b', title: 'New', updatedAt: '2026-09-03T00:00:00Z' }),
    ], { session: session('cur', { cwd: '/w/a', title: 'Current' }), status: 'ready' })
    expect(visibleRows(rows, { filter: 'all', grouping: 'project', search: '' }).map(row => row.id)).toEqual(['cur', 'new', 'old'])
    expect(visibleRows(rows, { filter: 'inactive', grouping: 'project', search: '' }).map(row => row.id)).toEqual(['new', 'old'])
    expect(visibleRows(rows, { filter: 'all', grouping: 'project', search: 'OLD' }).map(row => row.id)).toEqual(['old'])
    expect(visibleRows(rows, { filter: 'all', grouping: 'status', search: '' })[0]!.id).toBe('cur')
  })

  it('formats ages and home-relative paths like Codex', () => {
    const now = Date.parse('2026-09-26T12:00:00Z')
    expect(relativeAge(now - 2_000, now)).toBe('now')
    expect(relativeAge(now - 90_000, now)).toBe('1m ago')
    expect(relativeAge(now - 3 * 86_400_000, now)).toBe('3d ago')
    expect(relativeAge(0, now)).toBe('-')
    expect(displayCwd('/home/me/code/app', '/home/me')).toBe('~/code/app')
  })
})
