import { describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execa } from 'execa'

describe('conversation history persistence', () => {
  it('keeps concurrent snapshots complete and private', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-history-'))
    const first = [{ role: 'system' as const, content: 'system prompt' }, { role: 'user' as const, content: 'A'.repeat(20_000) }]
    const second = [{ role: 'system' as const, content: 'system prompt' }, { role: 'user' as const, content: 'short snapshot' }]
    const path = join(root, 'history.json')

    try {
      const historyModule = new URL('../src/agent/history.ts', import.meta.url).href
      const script = `
        import { readFile, stat } from 'node:fs/promises'
        const { saveHistory } = await import(${JSON.stringify(historyModule)})
        const first = [{ role: 'system', content: 'system prompt' }, { role: 'user', content: 'A'.repeat(20_000) }]
        const second = [{ role: 'system', content: 'system prompt' }, { role: 'user', content: 'short snapshot' }]
        const path = process.env.HISTORY_TEST_PATH
        await Promise.all([saveHistory(first, path), saveHistory(second, path)])
        console.log(JSON.stringify({ saved: JSON.parse(await readFile(path, 'utf8')), mode: (await stat(path)).mode & 0o777 }))
      `
      const { stdout } = await execa(process.execPath, ['-e', script], {
        cwd: process.cwd(),
        env: { ...process.env, HISTORY_TEST_PATH: path },
      })
      const { saved, mode } = JSON.parse(stdout) as { saved: typeof first; mode: number }
      expect([first, second]).toContainEqual(saved)
      if (process.platform !== 'win32') expect(mode).toBe(0o600)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
