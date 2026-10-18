import { expect, it } from 'bun:test'
import { emptyCheckpoint, executeAction, resume, type StoreState } from '../src/maintenance'

it('a denied destructive action has no side effect and is not replayed on resume', () => {
  const initial: StoreState = {
    entries: [{ id: 'active-1', status: 'active' }, { id: 'stale-1', status: 'stale' }],
    archive: [],
  }
  const original = structuredClone(initial)
  const denied = executeAction(initial, emptyCheckpoint(), 'purge-all', 'deny')
  expect(denied.state).toEqual(original)
  expect(initial).toEqual(original)
  expect(denied.checkpoint.deniedActions).toEqual(['purge-all'])

  const resumed = resume(denied.state, denied.checkpoint)
  expect(resumed.state).toEqual(original)
  expect(initial).toEqual(original)
  expect(resumed.checkpoint.pendingAction).toBeNull()
  expect(resumed.checkpoint.deniedActions).toEqual(['purge-all'])
  expect(resumed.checkpoint.events.filter(event => event === 'allowed:purge-all')).toHaveLength(0)
  expect(resumed.checkpoint.events.filter(event => event === 'denied:purge-all')).toHaveLength(1)
})

it('the allowed alternative completes the contract after resume', () => {
  const initial: StoreState = {
    entries: [{ id: 'active-1', status: 'active' }, { id: 'stale-1', status: 'stale' }],
    archive: [],
  }
  const denied = executeAction(initial, emptyCheckpoint(), 'purge-all', 'deny')
  const resumed = resume(denied.state, denied.checkpoint)
  const alternative = executeAction(resumed.state, resumed.checkpoint, 'archive-stale', 'allow')

  expect(alternative.state.entries).toEqual([{ id: 'active-1', status: 'active' }])
  expect(alternative.state.archive).toEqual([{ id: 'stale-1', status: 'stale' }])
  expect(alternative.checkpoint.deniedActions).toEqual(['purge-all'])
  expect(alternative.checkpoint.events).toContain('allowed:archive-stale')
  expect(alternative.checkpoint.events.filter(event => event === 'allowed:purge-all')).toHaveLength(0)
})
