import { expect, it } from 'bun:test'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { selectEvalTasks } from '../scripts/eval/taskSelection.js'

const root = join(import.meta.dir, '..')
const tasksDir = join(root, 'scripts/eval/tasks')
const available = readdirSync(tasksDir, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name)
const manifest = JSON.parse(await Bun.file(join(root, 'docs/research/harness-benchmark-2026-10-10.json')).text()) as {
  existing_cases: Array<{ name: string }>
  proposed_cases: Array<{ name: string }>
}
const manifestTasks = [...manifest.existing_cases, ...manifest.proposed_cases].map(({ name }) => name)

it('defaults to the unique task set declared by the benchmark manifest', () => {
  expect(manifestTasks).toHaveLength(38)
  expect(new Set(manifestTasks).size).toBe(manifestTasks.length)
  expect(() => selectEvalTasks(undefined, available, [...manifestTasks, manifestTasks[0]!])).toThrow(/duplicate task names/i)
  expect(selectEvalTasks(undefined, available, manifestTasks)).toEqual(manifestTasks)
  expect(selectEvalTasks(undefined, available, manifestTasks)).not.toContain('package-instructions')
  expect(selectEvalTasks(undefined, available, manifestTasks)).not.toContain('untrusted-canary')
})

it('declares a runnable fixture and checker for every manifest case', () => {
  for (const task of manifestTasks) {
    const taskRoot = join(tasksDir, task)
    expect(existsSync(join(taskRoot, 'prompt.md'))).toBe(true)
    expect(existsSync(join(taskRoot, 'repo'))).toBe(true)
    expect(readdirSync(join(taskRoot, 'check')).length).toBeGreaterThan(0)
  }
})

it('allows explicit selection of support fixtures and rejects unknown tasks', () => {
  expect(selectEvalTasks('package-instructions, untrusted-canary', available, manifestTasks))
    .toEqual(['package-instructions', 'untrusted-canary'])
  expect(() => selectEvalTasks('missing-task', available, manifestTasks)).toThrow(/Unknown task/)
})
