import { afterEach, expect, it } from 'bun:test'
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runIsolatedChecker } from '../scripts/eval/checker.js'
import { sandboxAvailable } from '../src/utils/platform.js'

const scratch: string[] = []
const sandboxTest = it.skipIf(!sandboxAvailable())
const taskDir = join(import.meta.dir, '../scripts/eval/tasks/memory-update-and-abstain')
const originalMemory = {
  project: 'deepseek-code',
  facts: [
    { key: 'web_port', value: 3000, source: 'sessions/01-port.md', status: 'superseded' },
    { key: 'web_port', value: 4100, source: 'sessions/02-port-move.md', status: 'current' },
  ],
}
const correctAnswers = { web_port: 4100, analytics_port: null, deployment_region: null }

afterEach(async () => Promise.all(scratch.splice(0).map(path => rm(path, { recursive: true, force: true }))))

sandboxTest('C35 checker accepts the corrected reference and rejects stale, guessed, leaked, or untraceable facts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'eval-c35-reference-'))
  scratch.push(root)
  const checkDir = join(root, '__eval_check__')
  await cp(join(taskDir, 'check'), checkDir, { recursive: true })
  await cp(join(taskDir, 'repo/memory'), join(root, 'memory'), { recursive: true })

  const check = async (memory: unknown, answers: unknown) => {
    await writeFile(join(root, 'memory/current-facts.json'), JSON.stringify(memory))
    await writeFile(join(root, 'answers.json'), JSON.stringify(answers))
    return runIsolatedChecker(['test', './__eval_check__'], root, { readOnlyPaths: ['__eval_check__'] })
  }

  const reference = await check(originalMemory, correctAnswers)
  expect(reference.exitCode).toBe(0)
  expect(reference.positiveTestEvidence).toBe(true)

  const stalePort = await check({ ...originalMemory, facts: originalMemory.facts.map(fact => fact.value === 3000 ? { ...fact, status: 'current' } : fact) }, correctAnswers)
  expect(stalePort.exitCode).not.toBe(0)

  const wrongCurrentPort = await check({ ...originalMemory, facts: originalMemory.facts.map(fact => fact.value === 4100 ? { ...fact, value: 4200 } : fact) }, { ...correctAnswers, web_port: 4200 })
  expect(wrongCurrentPort.exitCode).not.toBe(0)

  const guessedAnswer = await check(originalMemory, { ...correctAnswers, deployment_region: 'us-east-1' })
  expect(guessedAnswer.exitCode).not.toBe(0)

  const leakedAnswer = await check(originalMemory, { ...correctAnswers, analytics_port: 4800 })
  expect(leakedAnswer.exitCode).not.toBe(0)

  const leakedMemory = await check({ ...originalMemory, facts: [...originalMemory.facts, { key: 'analytics_port', value: 4800, source: 'other-projects/paperkite.md', status: 'current' }] }, correctAnswers)
  expect(leakedMemory.exitCode).not.toBe(0)

  const badProvenance = await check({ ...originalMemory, facts: originalMemory.facts.map(fact => fact.value === 4100 ? { ...fact, source: 'sessions/01-port.md' } : fact) }, correctAnswers)
  expect(badProvenance.exitCode).not.toBe(0)

  await writeFile(join(root, 'memory/sessions/02-port-move.md'), 'The deepseek-code service now uses port 4200.')
  const alteredEvidence = await check(originalMemory, correctAnswers)
  expect(alteredEvidence.exitCode).not.toBe(0)
})
