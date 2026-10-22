import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

let testDir: string
let previousHome: string | undefined

beforeEach(async () => {
  previousHome = process.env.HOME
  testDir = await mkdtemp(join(tmpdir(), 'dsk-history-test-'))
  process.env.HOME = testDir
})

afterEach(async () => {
  try {
    await rm(testDir, { recursive: true, force: true })
  } finally {
    if (previousHome === undefined) delete process.env.HOME
    else process.env.HOME = previousHome
  }
})

describe('loadInputHistory', () => {
  it('returns an empty list when the file does not exist', async () => {
    const { loadInputHistory } = await import('../src/agent/inputHistory.js')
    expect(await loadInputHistory()).toEqual([])
  })

  it('returns saved entries', async () => {
    const fs = await import('fs/promises')
    const historyPath = join(testDir, '.deepseek', 'input_history.json')
    await fs.mkdir(join(testDir, '.deepseek'), { recursive: true })
    await fs.writeFile(historyPath, JSON.stringify(['entry1', 'entry2']), 'utf-8')
    const { loadInputHistory } = await import('../src/agent/inputHistory.js')
    expect(await loadInputHistory()).toEqual(['entry1', 'entry2'])
  })
})

describe('appendInputHistory', () => {
  it('persists a new entry', async () => {
    const { appendInputHistory, loadInputHistory } = await import('../src/agent/inputHistory.js')
    await appendInputHistory('new entry')
    const history = await loadInputHistory()
    expect(history).toContain('new entry')
  })

  it('preserves concurrent prompt appends and writing-style samples', async () => {
    const { appendInputHistory, loadInputHistory, loadWritingStyle } = await import('../src/agent/inputHistory.js')
    await Promise.all([appendInputHistory('first message'), appendInputHistory('second message')])

    expect((await loadInputHistory()).sort()).toEqual(['first message', 'second message'])
    expect((await loadWritingStyle()).samples).toBe(2)
  })

  it('does not duplicate identical consecutive entries', async () => {
    const fs = await import('fs/promises')
    const historyPath = join(testDir, '.deepseek', 'input_history.json')
    await fs.mkdir(join(testDir, '.deepseek'), { recursive: true })
    await fs.writeFile(historyPath, JSON.stringify(['repeated entry']), 'utf-8')
    const { appendInputHistory, loadInputHistory } = await import('../src/agent/inputHistory.js')
    await appendInputHistory('repeated entry')
    const history = await loadInputHistory()
    expect(history.filter(e => e === 'repeated entry').length).toBe(1)
  })

  it('respects the 200-entry limit', async () => {
    const fs = await import('fs/promises')
    const historyPath = join(testDir, '.deepseek', 'input_history.json')
    const entries = Array.from({ length: 250 }, (_, i) => `entry-${i}`)
    await fs.mkdir(join(testDir, '.deepseek'), { recursive: true })
    await fs.writeFile(historyPath, JSON.stringify(entries), 'utf-8')
    const { appendInputHistory, loadInputHistory } = await import('../src/agent/inputHistory.js')
    await appendInputHistory('new entry')
    const history = await loadInputHistory()
    expect(history.length).toBeLessThanOrEqual(200)
  })

  it('does not save commands that start with /', async () => {
    const { appendInputHistory, loadInputHistory } = await import('../src/agent/inputHistory.js')
    await appendInputHistory('/help')
    await appendInputHistory('/clear')
    await appendInputHistory('/stats')
    const history = await loadInputHistory()
    expect(history.filter(e => e.startsWith('/'))).toHaveLength(0)
  })

  it('does not save shell commands that start with !', async () => {
    const { appendInputHistory, loadInputHistory } = await import('../src/agent/inputHistory.js')
    await appendInputHistory('!ls -la')
    await appendInputHistory('! git status')
    const history = await loadInputHistory()
    expect(history.filter(e => e.trimStart().startsWith('!'))).toHaveLength(0)
  })

  it('saves normal messages that are not commands', async () => {
    const { appendInputHistory, loadInputHistory } = await import('../src/agent/inputHistory.js')
    await appendInputHistory('explain this code')
    const history = await loadInputHistory()
    expect(history).toContain('explain this code')
  })

  it('learns basic user writing-style statistics', async () => {
    const { appendInputHistory, loadWritingStyle, describeWritingStyle } = await import('../src/agent/inputHistory.js')
    await appendInputHistory('yes, do this.')
    const style = await loadWritingStyle()
    expect(style.samples).toBe(1)
    expect(style.lowercase).toBe(1)
    expect(style.noAccents).toBe(1)
    expect(style.comma).toBe(1)
    expect(style.period).toBe(1)
    expect(describeWritingStyle(style)).toContain('lowercase')
  })
})
