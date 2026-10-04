import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BotStore } from '../src/bots/store.js'
import { botControl } from '../src/bots/control.js'
import { removeTempDirectory } from './helpers/removeTempDirectory.js'

const stores: BotStore[] = [], directories: string[] = []
function database() {
  const directory = mkdtempSync(join(tmpdir(), 'dsk-bot-groups-')); directories.push(directory)
  const store = new BotStore({ path: join(directory, 'state.db') }); stores.push(store)
  return { store, directory }
}
function create(store: BotStore, name: string) { return store.createBot({ name, projectRoot: process.cwd(), instructions: 'Coordinate on the assigned project work.' }) }
afterEach(async () => { for (const store of stores.splice(0)) store.close(); for (const directory of directories.splice(0)) await removeTempDirectory(directory) })

describe('persistent bot collaboration groups', () => {
  it('serializes a shared Codimium browser, routes group results and resumes staged deletion', async () => {
    const { store, directory } = database(), alpha = create(store, 'alpha'), beta = create(store, 'beta')
    const group = store.createGroup({ name: 'Release room', botIds: [alpha.id, beta.id], shareBrowser: true })
    expect(statSync(directory).isDirectory()).toBe(true)
    const memoryStore = new BotStore({ memory: true }); stores.push(memoryStore)
    expect(() => memoryStore.createGroup({ name: 'memory room', botIds: [alpha.id, beta.id], shareBrowser: true })).toThrow('file-backed')
    const longKey = 'k'.repeat(256)
    const sent = store.sendGroupMessage(group.id, 'Inspect release readiness and report evidence.', longKey)
    expect(sent.runs).toHaveLength(2)
    expect(sent.runs.every(run => run.occurrenceId.length <= 256)).toBe(true)
    expect(store.sendGroupMessage(group.id, 'Inspect release readiness and report evidence.', longKey).runs.map(run => run.id)).toEqual(sent.runs.map(run => run.id))
    expect(() => store.sendGroupMessage(group.id, 'Different task', longKey)).toThrow('collision')
    expect(() => store.sendGroupMessage(group.id, 'api_key=sk_live_fakecredentialvalue', 'secret-message')).toThrow('credentials')
    const first = store.claim(alpha.id, 'alpha-worker')!
    expect(first.groupId).toBe(group.id)
    expect(store.browserSessionIdentity(first)).toBe(`bot-group:${group.id}`)
    expect(store.claim(beta.id, 'beta-worker')).toBeNull()
    store.finish(first.id, 'alpha-worker', 'completed', 'Release notes are ready.')
    expect(store.claim(beta.id, 'beta-worker')).toBeNull()
    store.acknowledgeStop(first.id, 'alpha-worker')
    const second = store.claim(beta.id, 'beta-worker')!
    expect(store.browserSessionIdentity(second)).toBe(store.browserSessionIdentity(first))
    expect(store.groupContext(beta.id, group.id, 20, 16_000, second.groupMessageId)).toContain('Release notes are ready.')
    store.finish(second.id, 'beta-worker', 'completed', 'Smoke checks passed.')
    store.acknowledgeStop(second.id, 'beta-worker')
    expect(store.groupMessages(group.id).filter(message => message.sender === 'bot')).toHaveLength(2)
    expect(await store.deleteGroup(group.id, group.name)).toEqual({ deleted: true })
    expect(store.listGroups()).toHaveLength(0)
    expect(() => store.getGroup(group.id)).toThrow('not found')
  })

  it('keeps private-browser member runs parallel and enforces artifact versions and membership', async () => {
    const { store, directory } = database(), alpha = create(store, 'alpha'), beta = create(store, 'beta'), outsider = create(store, 'outsider')
    const group = store.createGroup({ name: 'Research room', botIds: [alpha.id, beta.id] })
    const sent = store.sendGroupMessage(group.id, 'Compare the two approaches.', 'research-task')
    const a = store.claim(alpha.id, 'alpha-worker')!, b = store.claim(beta.id, 'beta-worker')!
    expect(a.groupId).toBe(group.id); expect(b.groupId).toBe(group.id)
    expect(store.browserSessionIdentity(a)).not.toBe(store.browserSessionIdentity(b))
    expect(store.groupBrowserDirectory.bind(store, group.id)).toThrow('does not share')
    const tool = botControl(store, () => a)
    const created = JSON.parse(await tool.execute({ action: 'write_artifact', name: 'findings.md', content: 'Alpha found three useful sources.', expectedVersion: 0 }))
    expect(created).toMatchObject({ name: 'findings.md', version: 1 })
    expect(JSON.parse(await tool.execute({ action: 'read_artifact', name: 'findings.md' })).content).toBe('Alpha found three useful sources.')
    expect(JSON.parse(await tool.execute({ action: 'artifacts' })).map((item: { name: string }) => item.name)).toEqual(['findings.md'])
    await expect(tool.execute({ action: 'write_artifact', name: 'findings.md', content: 'Stale edit', expectedVersion: 0 })).rejects.toThrow('current version')
    const revised = JSON.parse(await tool.execute({ action: 'write_artifact', name: 'findings.md', content: 'Alpha found three current sources.', expectedVersion: 1 }))
    expect(revised.version).toBe(2)
    expect(() => store.groupArtifacts(group.id, outsider.id)).toThrow('not a member')
    expect(() => store.groupContext(outsider.id, group.id)).toThrow('not a member')
    expect(() => store.writeGroupArtifact(group.id, alpha.id, a.id, '../outside', 'bad', 0)).toThrow('name')
    expect(() => store.writeGroupArtifact(group.id, alpha.id, a.id, 'secret.md', 'token=abc123secretvalue', 0)).toThrow('credentials')
    expect(store.readGroupArtifact(group.id, beta.id, 'findings.md').version).toBe(2)
    expect(sent.runs).toHaveLength(2)
    for (const [run, owner] of [[a, 'alpha-worker'], [b, 'beta-worker']] as const) {
      store.finish(run.id, owner, 'completed', 'Work done.')
      store.acknowledgeStop(run.id, owner)
    }
    const browserProfile = store.groupBrowserDirectory.bind(store, group.id)
    expect(() => browserProfile()).toThrow('does not share')
    const deletion = await store.deleteGroup(group.id, group.id)
    expect(deletion).toEqual({ deleted: true })
    expect(store.groupMessages.bind(store, group.id)).toThrow('not found')
    expect(directory).toContain('dsk-bot-groups-')
  })

  it('rejects deletion with active work and safely retries an interrupted cleanup', async () => {
    const { store, directory } = database(), alpha = create(store, 'alpha'), beta = create(store, 'beta')
    const group = store.createGroup({ name: 'Ops room', botIds: [alpha.id, beta.id], shareBrowser: true })
    const profile = store.groupBrowserDirectory(group.id)
    store.sendGroupMessage(group.id, 'Check operations.', 'ops-task')
    await expect(store.deleteGroup(group.id, group.name)).rejects.toThrow('Finish or cancel')
    const a = store.claim(alpha.id, 'ops-worker')!
    store.finish(a.id, 'ops-worker', 'completed', 'Checked.')
    store.acknowledgeStop(a.id, 'ops-worker')
    const b = store.claim(beta.id, 'ops-worker-2')!
    store.finish(b.id, 'ops-worker-2', 'completed', 'Checked too.')
    store.acknowledgeStop(b.id, 'ops-worker-2')
    store.store.run('UPDATE bot_groups SET deleting=1 WHERE id=?', group.id)
    expect(store.getGroup(group.id, true).deleting).toBe(true)
    expect(() => store.getGroup(group.id)).toThrow('being deleted')
    expect(await store.deleteGroup(group.id, group.name)).toEqual({ deleted: true })
    expect(() => statSync(profile)).toThrow()
    expect(directory).toContain('dsk-bot-groups-')
  })
})
