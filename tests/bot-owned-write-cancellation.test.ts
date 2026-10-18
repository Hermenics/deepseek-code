import { expect, it } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { BotStore } from '../src/bots/store.js'
import { waitForChildFile } from './helpers/waitForChildFile.js'

it('cancels an owned write promptly despite a configured synchronous SQLite busy timeout', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'deepseek-owned-write-cancel-'))
  const path = join(directory, 'state.db'), locked = join(directory, 'locked'), release = join(directory, 'release')
  const store = new BotStore({ path, busyTimeoutMs: 1000 })
  const controller = new AbortController()
  let writer: ReturnType<typeof Bun.spawn> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const bot = store.createBot({ name: 'cancellation', projectRoot: directory, instructions: 'Fixture' })
    store.enqueue(bot.id, 'Observe cancellation')
    const run = store.claim(bot.id, 'owner')!
    const child = Bun.spawn([process.execPath, '-e', `
      import { Database } from 'bun:sqlite';
      import { existsSync, writeFileSync } from 'node:fs';
      const [path, locked, release] = process.argv.slice(1);
      const db = new Database(path);
      db.exec('BEGIN IMMEDIATE');
      writeFileSync(locked, 'locked');
      while (!existsSync(release)) await Bun.sleep(10);
      db.exec('COMMIT'); db.close();
    `, path, locked, release], { stdin: 'ignore', stdout: 'ignore', stderr: 'pipe' })
    writer = child
    const errors = new Response(child.stderr).text()
    await waitForChildFile(locked, writer, errors, 2000)
    let mutations = 0
    const started = Date.now()
    timer = setTimeout(() => controller.abort(new Error('cancel fixture')), 30)
    await expect(store.writeOwned(run.id, 'owner', () => {
      mutations++
      return store.addNote(bot.id, 'Must not be retained', 'fixture')
    }, controller.signal)).rejects.toThrow('operation was aborted')
    expect(Date.now() - started).toBeLessThan(500)
    expect(writer.exitCode).toBeNull()
    expect(mutations).toBe(0)
    expect(store.store.query<{ timeout: number }>('PRAGMA busy_timeout')[0]!.timeout).toBe(1000)
    await writeFile(release, 'release')
    expect(await writer.exited).toBe(0)
    expect(store.notes(bot.id)).toHaveLength(0)
    expect(await store.writeOwned(run.id, 'owner', () => 'done')).toBe('done')
    expect(store.store.query<{ timeout: number }>('PRAGMA busy_timeout')[0]!.timeout).toBe(1000)
    await expect(store.writeOwned(run.id, 'owner', () => { throw new Error('callback failure') })).rejects.toThrow('callback failure')
    expect(store.store.query<{ timeout: number }>('PRAGMA busy_timeout')[0]!.timeout).toBe(1000)
    const duringWrite = new AbortController()
    await expect(store.writeOwned(run.id, 'owner', () => {
      store.addNote(bot.id, 'Must roll back before commit', 'fixture')
      duringWrite.abort(new Error('cancel before commit'))
    }, duringWrite.signal)).rejects.toThrow('cancel before commit')
    expect(store.notes(bot.id)).toHaveLength(0)
    expect(store.store.query<{ timeout: number }>('PRAGMA busy_timeout')[0]!.timeout).toBe(1000)
  } finally {
    clearTimeout(timer)
    controller.abort()
    if (writer?.exitCode === null) writer.kill()
    if (writer) await writer.exited
    store.close()
    await rm(directory, { recursive: true, force: true })
  }
})
