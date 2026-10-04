import { afterEach, describe, expect, it } from 'bun:test'
import { BotStore } from '../src/bots/store.js'
import { botControl } from '../src/bots/control.js'
import { botToolIsReadOnly, testModeAllowsReadOnlyTool } from '../src/bots/worker.js'

const stores: BotStore[] = []
function database() { const store = new BotStore({ memory: true }); stores.push(store); return store }
function create(store: BotStore, name: string) { return store.createBot({ name, projectRoot: process.cwd(), instructions: 'Handle only assigned work.' }) }
afterEach(() => { for (const store of stores.splice(0)) store.close() })

describe('bot long-history retrieval', () => {
  it('searches one bot history with bounded excerpts and terminal-state filtering', async () => {
    const store = database(), alpha = create(store, 'alpha'), beta = create(store, 'beta')
    const old = store.enqueue(alpha.id, 'Historical verification of release notes')
    store.claim(alpha.id, 'old-worker')
    store.finish(old.id, 'old-worker', 'completed', `Verified release marker ZETA-482. api_key=sk_live_historysecretvalue`)
    store.acknowledgeStop(old.id, 'old-worker')
    const otherBot = store.enqueue(beta.id, 'Historical verification in another private bot')
    store.claim(beta.id, 'other-worker'); store.finish(otherBot.id, 'other-worker', 'completed', 'ZETA-482 belongs to the other bot.'); store.acknowledgeStop(otherBot.id, 'other-worker')
    const active = store.enqueue(alpha.id, 'Historical verification still running')
    const found = store.searchHistory(alpha.id, 'ZETA-482')
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ runId: old.id, status: 'completed' })
    expect(found[0]!.resultExcerpt).toContain('[REDACTED]')
    expect(JSON.stringify(found)).not.toContain('sk_live_historysecretvalue')
    expect(store.searchHistory(beta.id, 'ZETA-482')).toHaveLength(1)
    expect(store.searchHistory(alpha.id, 'still running')).toHaveLength(0)
    expect(() => store.searchHistory(alpha.id, 'x')).toThrow('at least two')
    expect(() => store.searchHistory(alpha.id, 'zeta', 21)).toThrow('from 1 to 20')
    const tool = botControl(store, () => ({ ...store.getRun(active.id), owner: 'history-owner', status: 'running' }))
    const result = JSON.parse(await tool.execute({ action: 'history_search', query: 'ZETA-482', limit: 5 }))
    expect(result).toHaveLength(1)
    expect(botToolIsReadOnly('bot_control', { action: 'history_search' })).toBe(true)
    expect(testModeAllowsReadOnlyTool('bot_control', { action: 'history_search' })).toBe(true)
  })
})
