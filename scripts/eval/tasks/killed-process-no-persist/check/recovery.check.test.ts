import { expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const taskRoot = existsSync(join(process.cwd(), 'src/recovery.ts')) ? process.cwd() : join(import.meta.dir, '../repo')
const { recoverExecution } = await import(join(taskRoot, 'src/recovery.ts'))
type ExecutionSnapshot = { id: string; status: 'running' | 'timed_out' | 'failed' | 'completed'; stdout: string; artifactPath?: string }
const interrupted = JSON.parse(readFileSync(join(taskRoot, 'data/interrupted.json'), 'utf8')) as ExecutionSnapshot

it('does not promote timed-out partial stdout to a completed result', () => {
  const artifactPath = join(taskRoot, interrupted.artifactPath!)
  expect(existsSync(artifactPath)).toBe(false)
  const recovered = recoverExecution(interrupted, (path) => {
    const target = join(taskRoot, path)
    return existsSync(target) ? readFileSync(target, 'utf8') : null
  })
  expect(recovered.status).toBe('incomplete')
  expect(recovered).not.toHaveProperty('result')
})

it('requires both completed execution and a readable artifact', () => {
  const completed: ExecutionSnapshot = {
    id: 'run-complete', status: 'completed', stdout: 'progress: 100%', artifactPath: 'artifacts/report.json',
  }
  expect(recoverExecution(completed, () => null).status).toBe('incomplete')
  for (const status of ['running', 'timed_out', 'failed'] as const) {
    expect(recoverExecution({ ...completed, status }, () => '{"rows":2}').status).toBe('incomplete')
  }
})

it('returns the saved artifact content rather than progress output', () => {
  const completed: ExecutionSnapshot = {
    id: 'run-complete', status: 'completed', stdout: 'progress: 100%', artifactPath: 'artifacts/report.json',
  }
  expect(recoverExecution(completed, () => '{"rows":2}')).toEqual({
    status: 'completed', result: '{"rows":2}', artifactPath: 'artifacts/report.json',
  })
})
