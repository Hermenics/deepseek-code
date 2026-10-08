import { expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BotStore } from '../src/bots/store.js'
import { POD_APPEARANCE_OPTIONS, POD_TONE_COLORS, type PodAppearance } from '../src/bots/types.js'

it('upgrades existing Pods and persists only validated appearance across reopen and export', () => {
  const directory = mkdtempSync(join(tmpdir(), 'pod-appearance-')), path = join(directory, 'state.db')
  const appearance: PodAppearance = { shape: 'cloud', tone: 'amber', eyes: 'curious', accessory: 'glasses' }
  let store = new BotStore({ path })
  try {
    const pod = store.createBot({ name: 'original', projectRoot: directory, instructions: 'Keep the existing responsibility.' })
    // Reconstruct the previous schema, then exercise the real migration on reopen.
    store.store.exec('ALTER TABLE bot_instances DROP COLUMN appearance; DELETE FROM _schema_version WHERE version=30')
    store.close(); store = new BotStore({ path })
    expect(store.getBot(pod.id).appearance).toBeUndefined()
    expect(store.setAppearance(pod.id, appearance).appearance).toEqual(appearance)
    for (const invalid of [null, [], {}, { ...appearance, shape: '<svg onload=alert(1)>' }, { ...appearance, tone: 'url(https://outside.example)' }, { ...appearance, eyes: 'unknown' }, { ...appearance, accessory: 'unknown' }, { ...appearance, extra: 'field' }]) {
      expect(() => store.setAppearance(pod.id, invalid)).toThrow()
      expect(store.getBot(pod.id).appearance).toEqual(appearance)
    }
    const created = store.createBot({ name: 'custom', projectRoot: directory, instructions: 'A distinct teammate.', appearance })
    expect(created.appearance).toEqual(appearance)
    expect(store.activeStatus(created.id)).toBeNull()
    const working = store.enqueue(created.id, 'Already working')
    store.claim(created.id, 'status-check')
    const queued = store.enqueue(created.id, 'Next task')
    expect(store.activeStatus(created.id)).toBe('running')
    expect(store.listRuns(created.id, 1)[0]?.id).toBe(queued.id)
    store.finish(working.id, 'status-check', 'completed', 'Done')
    expect(store.activeStatus(created.id)).toBe('queued')
    store.cancel(queued.id)
    expect(store.activeStatus(created.id)).toBeNull()
    store.close(); store = new BotStore({ path })
    expect(store.getBot(pod.id).appearance).toEqual(appearance)
    expect(store.listBots().find(item => item.id === created.id)?.appearance).toEqual(appearance)
    expect(store.exportBot(pod.id)).toMatchObject({ bot: { appearance } })
    expect(store.getBot(pod.id).instructions).toBe('Keep the existing responsibility.')
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }) }
})

it('ignores malformed stored appearance while keeping reads and repairs available', () => {
  const store = new BotStore({ memory: true })
  const appearance: PodAppearance = { shape: 'cloud', tone: 'amber', eyes: 'curious', accessory: 'glasses' }
  try {
    const pod = store.createBot({ name: 'legacy', projectRoot: process.cwd(), instructions: 'Keep this responsibility.', appearance })
    for (const stored of [null, '', '{', 'null', '[]', '{}', '42', JSON.stringify({ ...appearance, shape: 'unknown' }), JSON.stringify({ ...appearance, tone: 'unknown' }), JSON.stringify({ ...appearance, eyes: 'unknown' }), JSON.stringify({ ...appearance, accessory: 'unknown' }), JSON.stringify({ ...appearance, extra: 'field' })]) {
      store.store.run('UPDATE bot_instances SET appearance=? WHERE id=?', stored, pod.id)
      expect(store.getBot(pod.id).appearance).toBeUndefined()
      expect(store.listBots()[0]?.appearance).toBeUndefined()
      expect(store.exportBot(pod.id)).toMatchObject({ bot: { instructions: pod.instructions } })
      expect((store.exportBot(pod.id).bot as { appearance?: PodAppearance }).appearance).toBeUndefined()
    }
    expect(() => store.setAppearance(pod.id, { ...appearance, shape: 'unknown' })).toThrow()
    expect(store.setAppearance(pod.id, appearance).appearance).toEqual(appearance)
  } finally { store.close() }
})

it('saves every expanded appearance option without changing the Pod job', () => {
  const directory = mkdtempSync(join(tmpdir(), 'pod-options-')), path = join(directory, 'state.db')
  let store = new BotStore({ path })
  try {
    const bot = store.createBot({ name: 'designer', projectRoot: directory, instructions: 'Keep this responsibility.' })
    let appearance: PodAppearance = { shape: 'circle', tone: 'blue', eyes: 'round', accessory: 'none' }
    for (const [key, choices] of Object.entries(POD_APPEARANCE_OPTIONS)) {
      for (const value of choices) {
        appearance = { ...appearance, [key]: value }
        expect(store.setAppearance(bot.id, appearance).appearance).toEqual(appearance)
        expect(store.exportBot(bot.id)).toMatchObject({ bot: { appearance, instructions: 'Keep this responsibility.' } })
      }
    }
    for (const tone of POD_APPEARANCE_OPTIONS.tone) expect(POD_TONE_COLORS[tone]).toMatch(/^#[a-f0-9]{6}$/)
    store.close(); store = new BotStore({ path })
    expect(store.getBot(bot.id).appearance).toEqual(appearance)
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }) }
})
