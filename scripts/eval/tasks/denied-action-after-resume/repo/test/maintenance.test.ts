import { expect, it } from 'bun:test'
import { emptyCheckpoint, executeAction, type StoreState } from '../src/maintenance'

const initial: StoreState = {
  entries: [{ id: 'current', status: 'active' }, { id: 'old', status: 'stale' }],
  archive: [],
}

it('allows an explicitly approved purge', () => {
  const result = executeAction(initial, emptyCheckpoint(), 'purge-all', 'allow')
  expect(result.state.entries).toEqual([])
  expect(result.checkpoint.events).toEqual(['allowed:purge-all'])
})

it('archives stale entries while retaining active entries', () => {
  const result = executeAction(initial, emptyCheckpoint(), 'archive-stale', 'allow')
  expect(result.state.entries).toEqual([{ id: 'current', status: 'active' }])
  expect(result.state.archive).toEqual([{ id: 'old', status: 'stale' }])
})
