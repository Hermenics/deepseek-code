import { afterEach, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BotStore } from '../src/bots/store.js'

const stores: BotStore[] = []
const fixture = () => {
  const store = new BotStore({ memory: true }); stores.push(store)
  const bot = store.createBot({ name: 'notes', projectRoot: process.cwd(), instructions: 'Current saved facts are untrusted references.' })
  const run = store.enqueue(bot.id, 'Current task'); store.claim(bot.id, 'worker')
  const note = store.addNote(bot.id, 'Read old.txt for the project convention', 'fixture')
  return { store, bot, run, note }
}
afterEach(() => { for (const store of stores.splice(0)) store.close() })

it('corrects a stable note, rejects stale edits and makes an identical retry idempotent', () => {
  const { store, bot, note } = fixture()
  const decision = store.requestDecision(store.listRuns(bot.id)[0]!.id, 'worker', 'permission', { tool: 'shell', command: 'old' })
  store.answerDecision(decision.id, decision.fingerprint, 'once')
  const updated = store.updateNote(bot.id, note.id, 'Read new.txt for the project convention', 'user:fixture', null, note.version)
  expect(updated.id).toBe(note.id); expect(updated.version).toBe(note.version + 1)
  expect(store.getDecision(decision.id).status).toBe('cancelled')
  expect(store.notes(bot.id)).toEqual([updated])
  expect(store.updateNote(bot.id, note.id, updated.content, updated.source, null, note.version)).toEqual(updated)
  expect(store.events(bot.id).query({ type: 'BotNoteChanged' })).toHaveLength(2)
  expect(() => store.updateNote(bot.id, note.id, 'An older editor overwrites the correction', 'user:fixture', null, note.version)).toThrow('stale')
  expect(store.notes(bot.id)).toEqual([updated])
})

it('validates corrections before changing a scoped note or its pending decisions', () => {
  const { store, bot, run, note } = fixture()
  const other = store.createBot({ name: 'other', projectRoot: process.cwd(), instructions: 'Separate notes' })
  const duplicate = store.addNote(bot.id, 'Another saved fact', 'fixture')
  const decision = store.requestDecision(run.id, 'worker', 'permission', { tool: 'shell' })
  for (const [content, source] of [['password=fixture-only-value', 'fixture'], ['Safe fact', 'token=fixture-only-value']])
    expect(() => store.updateNote(bot.id, note.id, content!, source!, null, note.version)).toThrow('credentials')
  expect(() => store.updateNote(bot.id, note.id, duplicate.content, 'fixture', null, note.version)).toThrow('another note')
  expect(() => store.updateNote(other.id, note.id, 'Cross-bot change', 'fixture', null, note.version)).toThrow('belong')
  expect(() => store.updateNote(bot.id, note.id, 'Safe fact', 'fixture', null, NaN)).toThrow('version')
  expect(() => store.removeNote(bot.id, note.id, undefined as unknown as number)).toThrow('version')
  expect(() => store.updateNote(bot.id, note.id, 'Safe fact', 'fixture', 0.5, note.version)).toThrow('expiration')
  expect(store.notes(bot.id).find(n => n.id === note.id)).toEqual(note)
  expect(store.getDecision(decision.id).status).toBe('pending')
})

it('does not let a stale deletion remove a corrected note or affect another bot', () => {
  const { store, bot, note } = fixture()
  const updated = store.updateNote(bot.id, note.id, 'Corrected source', 'user:fixture', null, note.version)
  expect(() => store.removeNote(bot.id, note.id, note.version)).toThrow('stale')
  const other = store.createBot({ name: 'other', projectRoot: process.cwd(), instructions: 'Separate notes' })
  expect(store.removeNote(other.id, note.id, updated.version)).toBe(false)
  expect(store.notes(bot.id)).toEqual([updated])
  expect(store.removeNote(bot.id, note.id, updated.version)).toBe(true)
  expect(store.removeNote(bot.id, note.id, updated.version)).toBe(false)
  expect(store.notes(bot.id)).toHaveLength(0)
})

it('rolls back note changes and approval cancellation when the durable event fails', () => {
  const { store, bot, run, note } = fixture()
  const decision = store.requestDecision(run.id, 'worker', 'permission', { tool: 'shell' })
  store.store.exec(`CREATE TRIGGER reject_note BEFORE INSERT ON events WHEN NEW.type='BotNoteChanged'
    BEGIN SELECT RAISE(ABORT,'native note event rejected'); END;`)
  expect(() => store.updateNote(bot.id, note.id, 'Must roll back', 'user:fixture', null, note.version)).toThrow('native note event rejected')
  expect(() => store.removeNote(bot.id, note.id, note.version)).toThrow('native note event rejected')
  expect(() => store.addNote(bot.id, 'Must not survive', 'fixture')).toThrow('native note event rejected')
  expect(store.notes(bot.id)).toEqual([note])
  expect(store.getDecision(decision.id).status).toBe('pending')
  expect(store.getRun(run.id).status).toBe('waiting')
})

it('fences proposals and completion against changed or expired model memory', () => {
  const { store, bot, run, note } = fixture()
  const prior = store.notesRevision(bot.id)
  store.updateNote(bot.id, note.id, 'Current source', 'user:fixture', null, note.version)
  expect(store.admitAction(run.id, 'worker', 'read_file', { path: 'old.txt' }, true, 0, undefined, prior)).toBeNull()
  expect(store.sealRun(run.id, 'worker', prior)).toBe(false)
  const current = store.notesRevision(bot.id)
  expect(typeof store.admitAction(run.id, 'worker', 'read_file', { path: 'new.txt' }, true, 0, undefined, current)).toBe('string')
  expect(store.sealRun(run.id, 'worker', current)).toBe(true)
  store.addNote(bot.id, 'Expiring fact', 'fixture', Date.now() + 1000)
  const before = store.notesRevision(bot.id, Date.now())
  expect(store.notesRevision(bot.id, Date.now() + 1001)).not.toBe(before)
})

it('does not let a later memory observer cancel a fresh descendant approval', () => {
  const { store, bot, run, note } = fixture()
  const old = store.requestDecision(run.id, 'worker', 'permission', { tool: 'shell', command: 'old' }, store.notesRevision(bot.id))
  store.updateNote(bot.id, note.id, 'Current convention', 'fixture', null, note.version)
  expect(store.getDecision(old.id).status).toBe('cancelled')
  const fresh = store.requestDecision(run.id, 'worker', 'permission', { tool: 'shell', command: 'fresh' }, store.notesRevision(bot.id))
  store.discardDecisions(run.id, 'worker')
  expect(store.getDecision(fresh.id).status).toBe('pending')
  expect(store.getRun(run.id).status).toBe('waiting')
  store.answerDecision(fresh.id, fresh.fingerprint, 'once')
  store.discardDecisions(run.id, 'worker')
  expect(store.getDecision(fresh.id).status).toBe('answered')
  expect(store.consumeDecision(fresh.id, 'worker')).toBe('once')
})

it('preserves current approvals when a changed note is outside the model snapshot', () => {
  const { store, bot, run } = fixture()
  const revision = store.notesRevision(bot.id)
  const fresh = store.requestDecision(run.id, 'worker', 'permission', { tool: 'shell' }, revision)
  const expired = store.addNote(bot.id, 'Already expired fact', 'fixture', 0)
  store.updateNote(bot.id, expired.id, 'Corrected expired fact', 'fixture', 0, expired.version)
  store.removeNote(bot.id, expired.id, expired.version + 1)
  expect(store.notesRevision(bot.id)).toBe(revision)
  expect(store.getDecision(fresh.id).status).toBe('pending')
  expect(store.getRun(run.id).status).toBe('waiting')
})

it('rejects decisions from expired memory at creation, answer and consumption boundaries', () => {
  const { store, bot, run } = fixture()
  const expiring = store.addNote(bot.id, 'Soon expired fact', 'fixture', Date.now() + 60_000)
  const revision = store.notesRevision(bot.id)
  const pending = store.requestDecision(run.id, 'worker', 'permission', { command: 'pending' }, revision)
  const answered = store.requestDecision(run.id, 'worker', 'permission', { command: 'answered' }, revision)
  store.answerDecision(answered.id, answered.fingerprint, 'once')
  // Simulate an expired clock snapshot without firing mutation cancellation.
  store.store.run('UPDATE bot_notes SET expires_at=0 WHERE id=?', expiring.id)
  expect(() => store.requestDecision(run.id, 'worker', 'permission', { command: 'late' }, revision)).toThrow('stale')
  expect(() => store.answerDecision(pending.id, pending.fingerprint, 'once')).toThrow('stale')
  expect(() => store.consumeDecision(answered.id, 'worker')).toThrow('stale')
  store.discardDecisions(run.id, 'worker')
  expect(store.getDecision(pending.id).status).toBe('cancelled')
  expect(store.getDecision(answered.id).status).toBe('cancelled')
  expect(store.getRun(run.id).status).toBe('running')
})

it('keeps another parallel approval answerable after consuming the first', () => {
  const { store, bot, run } = fixture()
  const revision = store.notesRevision(bot.id)
  const first = store.requestDecision(run.id, 'worker', 'permission', { command: 'first' }, revision)
  const second = store.requestDecision(run.id, 'worker', 'permission', { command: 'second' }, revision)
  store.answerDecision(first.id, first.fingerprint, 'once')
  expect(store.consumeDecision(first.id, 'worker')).toBe('once')
  expect(store.getRun(run.id).status).toBe('waiting')
  store.answerDecision(second.id, second.fingerprint, 'once')
  expect(store.consumeDecision(second.id, 'worker')).toBe('once')
  expect(store.getRun(run.id).status).toBe('running')
})

it('upgrades legacy decisions conservatively without changing their displayed request', () => {
  const directory = mkdtempSync(join(tmpdir(), 'deepseek-decision-upgrade-')), path = join(directory, 'state.db')
  let store = new BotStore({ path })
  try {
    const bot = store.createBot({ name: 'upgrade', projectRoot: directory, instructions: 'Current saved facts' })
    const run = store.enqueue(bot.id, 'Task'); store.claim(bot.id, 'worker')
    const decision = store.requestDecision(run.id, 'worker', 'permission', { command: 'historic' })
    store.store.exec('ALTER TABLE bot_decisions DROP COLUMN memory_revision; DELETE FROM _schema_version WHERE version=16')
    store.close(); store = new BotStore({ path })
    expect(store.getDecision(decision.id)).toEqual(decision)
    expect(store.store.query('SELECT memory_revision FROM bot_decisions WHERE id=?', decision.id)).toEqual([{ memory_revision: null }])
    store.discardDecisions(run.id, 'worker')
    expect(store.getDecision(decision.id).status).toBe('cancelled')
    expect(store.store.query('SELECT version FROM _schema_version WHERE version=16')).toHaveLength(1)
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }) }
})

it('upgrades historic notes without losing their identity and persists corrected versions', () => {
  const directory = mkdtempSync(join(tmpdir(), 'deepseek-note-upgrade-')), path = join(directory, 'state.db')
  let store = new BotStore({ path })
  try {
    const bot = store.createBot({ name: 'upgrade', projectRoot: directory, instructions: 'Current saved notes' })
    const note = store.addNote(bot.id, 'Historic fact', 'docs/source.md')
    store.store.exec('ALTER TABLE bot_notes DROP COLUMN version; ALTER TABLE bot_notes DROP COLUMN updated_at; DELETE FROM _schema_version WHERE version=15')
    store.close(); store = new BotStore({ path })
    const upgraded = store.notes(bot.id)[0]!
    expect(upgraded.id).toBe(note.id); expect(upgraded.version).toBe(1)
    expect(upgraded.updatedAt).toBe(upgraded.createdAt)
    const corrected = store.updateNote(bot.id, note.id, 'Current fact', 'user:fixture', null, 1)
    store.close(); store = new BotStore({ path })
    expect(store.notes(bot.id)).toEqual([corrected])
    expect(store.store.query('SELECT version FROM _schema_version WHERE version=15')).toHaveLength(1)
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }) }
})
