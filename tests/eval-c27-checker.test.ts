import { afterEach, expect, it } from 'bun:test'
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runIsolatedChecker } from '../scripts/eval/checker.js'
import { sandboxAvailable } from '../src/utils/platform.js'

const scratch: string[] = []
const sandboxTest = it.skipIf(!sandboxAvailable())
const checkerSource = join(import.meta.dir, '../scripts/eval/tasks/killed-process-no-persist/check')
const reference = `type Snapshot = { id: string; status: 'running' | 'timed_out' | 'failed' | 'completed'; stdout: string; artifactPath?: string }

export function recoverExecution(snapshot: Snapshot, readArtifact: (path: string) => string | null) {
  if (snapshot.status !== 'completed' || !snapshot.artifactPath) return { status: 'incomplete' as const }
  const result = readArtifact(snapshot.artifactPath)
  return result === null ? { status: 'incomplete' as const } : { status: 'completed' as const, result, artifactPath: snapshot.artifactPath }
}
`
const timeoutOnlyGuard = `type Snapshot = { id: string; status: 'running' | 'timed_out' | 'failed' | 'completed'; stdout: string; artifactPath?: string }

export function recoverExecution(snapshot: Snapshot, readArtifact: (path: string) => string | null) {
  if (snapshot.status === 'timed_out' || !snapshot.artifactPath) return { status: 'incomplete' as const }
  const result = readArtifact(snapshot.artifactPath)
  return result === null ? { status: 'incomplete' as const } : { status: 'completed' as const, result, artifactPath: snapshot.artifactPath }
}
`

afterEach(async () => Promise.all(scratch.splice(0).map(path => rm(path, { recursive: true, force: true }))))

sandboxTest('C27 checker rejects readable artifacts for running and failed executions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'eval-c27-checker-'))
  scratch.push(root)
  await mkdir(join(root, 'src'), { recursive: true })
  await mkdir(join(root, 'data'), { recursive: true })
  await cp(checkerSource, join(root, '__eval_check__'), { recursive: true })
  await writeFile(join(root, 'data/interrupted.json'), JSON.stringify({
    id: 'run-interrupted', status: 'timed_out', stdout: 'progress: 100%', artifactPath: 'artifacts/interrupted.json',
  }))

  const check = async (implementation: string) => {
    await writeFile(join(root, 'src/recovery.ts'), implementation)
    return runIsolatedChecker(['test', './__eval_check__'], root, { readOnlyPaths: ['__eval_check__'] })
  }

  const valid = await check(reference)
  expect(valid.exitCode).toBe(0)
  expect(valid.positiveTestEvidence).toBe(true)

  const regression = await check(timeoutOnlyGuard)
  expect(regression.exitCode).not.toBe(0)
})
