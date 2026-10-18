import { expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { recoverExecution, type ExecutionSnapshot } from '../src/recovery'

const dataRoot = join(import.meta.dir, '../data')
const execution = JSON.parse(readFileSync(join(dataRoot, 'interrupted.json'), 'utf8')) as ExecutionSnapshot

it('keeps a timed-out execution incomplete when its artifact was never saved', () => {
  const result = recoverExecution(execution, (path) => {
    const artifact = join(dataRoot, path)
    return existsSync(artifact) ? readFileSync(artifact, 'utf8') : null
  })
  expect(result.status).toBe('incomplete')
})
