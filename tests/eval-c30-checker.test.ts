import { afterEach, expect, it } from 'bun:test'
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runIsolatedChecker } from '../scripts/eval/checker.js'
import { sandboxAvailable } from '../src/utils/platform.js'

const scratch: string[] = []
const sandboxTest = it.skipIf(!sandboxAvailable())
const taskRoot = join(import.meta.dir, '../scripts/eval/tasks/denied-action-after-resume')

const referenceSource = `export interface Entry { id: string; status: 'active' | 'stale' }
export interface StoreState { entries: Entry[]; archive: Entry[] }
export type Action = 'purge-all' | 'archive-stale'
export type Permission = 'allow' | 'deny'
export interface Checkpoint { pendingAction: Action | null; deniedActions: Action[]; events: string[] }
export interface ActionResult { state: StoreState; checkpoint: Checkpoint }
export function executeAction(state: StoreState, checkpoint: Checkpoint, action: Action, permission: Permission): ActionResult {
  if (permission === 'deny') return { state, checkpoint: { pendingAction: null, deniedActions: [...checkpoint.deniedActions, action], events: [...checkpoint.events, 'denied:' + action] } }
  if (action === 'purge-all') return { state: { ...state, entries: [] }, checkpoint: { ...checkpoint, pendingAction: null, events: [...checkpoint.events, 'allowed:' + action] } }
  const stale = state.entries.filter(entry => entry.status === 'stale')
  const active = state.entries.filter(entry => entry.status === 'active')
  return { state: { entries: active, archive: [...state.archive, ...stale] }, checkpoint: { ...checkpoint, pendingAction: null, events: [...checkpoint.events, 'allowed:' + action] } }
}
export function resume(state: StoreState, checkpoint: Checkpoint): ActionResult { return { state, checkpoint } }
export function emptyCheckpoint(): Checkpoint { return { pendingAction: null, deniedActions: [], events: [] } }
`

afterEach(async () => Promise.all(scratch.splice(0).map(path => rm(path, { recursive: true, force: true }))))

async function createWorkspace(source: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'eval-c30-checker-'))
  scratch.push(root)
  await cp(join(taskRoot, 'repo'), root, { recursive: true })
  await cp(join(taskRoot, 'check'), join(root, '__eval_check__'), { recursive: true })
  await writeFile(join(root, 'src/maintenance.ts'), source)
  return root
}

async function check(root: string) {
  return runIsolatedChecker(['test', './__eval_check__'], root, { readOnlyPaths: ['__eval_check__'] })
}

sandboxTest('C30 checker accepts the reference and rejects dropped denial history or a still-pending denied action', async () => {
  const referenceRoot = await createWorkspace(referenceSource)
  const reference = await check(referenceRoot)
  expect(reference.exitCode).toBe(0)
  expect(reference.positiveTestEvidence).toBe(true)

  const droppedHistory = referenceSource.replace(
    'export function resume(state: StoreState, checkpoint: Checkpoint): ActionResult { return { state, checkpoint } }',
    'export function resume(state: StoreState, checkpoint: Checkpoint): ActionResult { return { state, checkpoint: { ...checkpoint, deniedActions: [] } } }',
  )
  const droppedHistoryRoot = await createWorkspace(droppedHistory)
  expect((await check(droppedHistoryRoot)).exitCode).not.toBe(0)

  const stillPending = referenceSource.replace(
    "if (permission === 'deny') return { state, checkpoint: { pendingAction: null,",
    "if (permission === 'deny') return { state, checkpoint: { pendingAction: action,",
  )
  const stillPendingRoot = await createWorkspace(stillPending)
  expect((await check(stillPendingRoot)).exitCode).not.toBe(0)
})
