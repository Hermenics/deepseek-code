import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { saveHistory } from '../src/agent/history.js'

let root = ''

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'deepseek-history-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('conversation history persistence', () => {
  it('keeps concurrent snapshots complete and private', async () => {
    const first = [{ role: 'system' as const, content: 'system prompt' }, { role: 'user' as const, content: 'A'.repeat(20_000) }]
    const second = [{ role: 'system' as const, content: 'system prompt' }, { role: 'user' as const, content: 'short snapshot' }]
    const path = join(root, 'history.json')

    await Promise.all([saveHistory(first, path), saveHistory(second, path)])

    const saved = JSON.parse(await readFile(path, 'utf8'))
    expect([first, second]).toContainEqual(saved)
    if (process.platform !== 'win32') expect((await stat(path)).mode & 0o777).toBe(0o600)
  })
})
