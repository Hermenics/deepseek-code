import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BotStore } from '../src/bots/store.js'
import { testModeAllowsReadOnlyTool } from '../src/bots/worker.js'
import { OrchestratorSession } from '../src/orchestration/OrchestratorSession.js'

const stores: BotStore[] = [], directories: string[] = []
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'deepseek-bot-test-mode-'))
  directories.push(directory)
  const store = new BotStore({ path: join(directory, 'state.db') }); stores.push(store)
  const bot = store.createBot({ name: 'researcher', projectRoot: directory, instructions: 'Research and report.' })
  return { directory, store, bot }
}
afterEach(() => { for (const store of stores.splice(0)) store.close(); for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })

describe('safe routine tests', () => {
  it('queues an idempotent preview without changing schedule or creating webhook receipts', () => {
    const { store, bot } = fixture()
    const routine = store.addRoutine(bot.id, { name: 'Daily review', prompt: 'Review local sources', schedule: { kind: 'daily', hour: 9, minute: 30, timeZone: 'America/Fortaleza' } })
    const beforeReceipts = store.store.query('SELECT * FROM bot_event_receipts')
    const first = store.testRoutineNow(bot.id, routine.id, 'preview-1')
    const retry = store.testRoutineNow(bot.id, routine.id, 'preview-1')
    expect(first).toMatchObject({ status: 'queued', testMode: true, source: `routine-test:${routine.id}:v${routine.version}`, prompt: routine.prompt })
    expect(retry.id).toBe(first.id)
    expect(store.routines(bot.id)).toEqual([routine])
    expect(store.store.query('SELECT * FROM bot_event_receipts')).toEqual(beforeReceipts)
    expect(store.routineRuns(bot.id, routine.id).map(run => run.id)).toEqual([first.id])
    expect(() => store.enqueue(bot.id, routine.prompt, first.source, first.occurrenceId)).toThrow('collision')
  })

  it('records proposals as simulated without opening an uncertain external-effect window', () => {
    const { store, bot } = fixture()
    const routine = store.addRoutine(bot.id, { name: 'Inspection', prompt: 'Inspect only', schedule: { kind: 'event', topic: 'fixture' } })
    const queued = store.testRoutineNow(bot.id, routine.id, 'proposal')
    const claimed = store.claim(bot.id, 'worker')!
    const result = store.simulateAction(claimed.id, 'worker', 'shell', { command: 'touch production.txt', token: 'sk-test-secret' }, 'child-1')
    const action = store.store.query<Record<string, unknown>>('SELECT * FROM bot_actions WHERE run_id=?', claimed.id)[0]!
    expect(result).toContain('not executed')
    expect(action).toMatchObject({ tool: 'shell', status: 'simulated', read_only: 1, checkpointed: 1 })
    expect(String(action.args)).not.toContain('sk-test-secret')
    expect(store.hasUncertainActions(queued.id)).toBe(false)
    expect(store.events(bot.id).query().some(event => event.type === 'BotActionSimulated' && event.payload.runId === queued.id)).toBe(true)
  })

  it('fences test-only writes and stale proposals in the simulation journal', () => {
    const { store, bot } = fixture()
    const normal = store.enqueue(bot.id, 'Normal work')
    const normalOwner = store.claim(bot.id, 'normal-owner')!
    expect(() => store.simulateAction(normal.id, 'normal-owner', 'shell', {})).toThrow('only valid in safe routine tests')
    store.finish(normalOwner.id, 'normal-owner', 'completed', 'done'); store.acknowledgeStop(normalOwner.id, 'normal-owner')
    const routine = store.addRoutine(bot.id, { name: 'Inspection', prompt: 'Inspect only', schedule: { kind: 'event', topic: 'fixture' } })
    const testRun = store.testRoutineNow(bot.id, routine.id, 'stale')
    store.claim(bot.id, 'test-owner')
    expect(store.simulateAction(testRun.id, 'test-owner', 'shell', {}, undefined, 99)).toBeNull()
    expect(store.store.query('SELECT * FROM bot_actions WHERE run_id=?', testRun.id)).toHaveLength(0)
  })

  it('does not allow a simulated browser preview to become a learned production skill', () => {
    const { store, bot } = fixture()
    const routine = store.addRoutine(bot.id, { name: 'Preview', prompt: 'Inspect only', schedule: { kind: 'event', topic: 'fixture' } })
    const testRun = store.testRoutineNow(bot.id, routine.id, 'cannot-learn')
    store.claim(bot.id, 'test-owner')
    store.finish(testRun.id, 'test-owner', 'completed', 'Preview finished')
    store.acknowledgeStop(testRun.id, 'test-owner')
    expect(() => store.learnProcedureRecord(bot.id, testRun.id, 'unsafe-preview')).toThrow('production run')
    expect(store.procedures(bot.id)).toHaveLength(0)
  })

  it('executes only local read tools and blocks browser, shell, network, MCP and mutation proposals', () => {
    for (const tool of ['read_file', 'read_folder', 'glob', 'grep', 'lsp', 'introspect', 'get_goal']) {
      expect(testModeAllowsReadOnlyTool(tool, {})).toBe(true)
    }
    for (const [tool, args] of [
      ['shell', { command: 'pwd' }], ['browser', { action: 'snapshot' }], ['web_fetch', { url: 'https://example.com' }],
      ['playwright__click', { selector: '#send' }], ['write_file', { path: 'output.txt' }],
      ['bot_control', { action: 'schedule' }], ['bot_control', { action: 'run_routine' }], ['ask_user_questions', { questions: [] }],
    ] as Array<[string, Record<string, unknown>]>) expect(testModeAllowsReadOnlyTool(tool, args)).toBe(false)
    expect(testModeAllowsReadOnlyTool('git', { action: 'diff' })).toBe(true)
    expect(testModeAllowsReadOnlyTool('git', { action: 'commit' })).toBe(false)
    expect(testModeAllowsReadOnlyTool('bot_control', { action: 'notes' })).toBe(true)
  })

  it('returns the simulation result without invoking the actual tool executor', async () => {
    const session = new OrchestratorSession({
      projectRoot: process.cwd(), logFile: null, snapshotFile: null,
      toolExecution: { before: async () => ({ kind: 'simulate', result: 'recorded only' }), after: async () => { throw new Error('after must not run') } },
    })
    let executed = false
    expect(await session.executeJournaled('shell', { command: 'touch target' }, async () => { executed = true; return 'executed' })).toBe('recorded only')
    expect(executed).toBe(false)
    await session.shutdown()
  })
})
