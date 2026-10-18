import { expect, it } from 'bun:test'
import { OrchestratorSession } from '../src/orchestration/OrchestratorSession.js'

it('limits fork context to declared dependencies and keeps concrete result references', () => {
  const session = new OrchestratorSession({ projectRoot: process.cwd(), logFile: null, snapshotFile: null })
  session.addPreviousResult('task-a', 'Inspect parser', {
    summary: 'Parser rejects duplicate keys.', confidence: 0.9,
    filesRead: ['src/parser.ts'], filesChanged: ['src/parser.ts'],
    issuesFound: ['Duplicate keys were silently accepted.'],
  })
  session.addPreviousResult('task-b', 'Inspect renderer', {
    summary: 'Renderer escapes HTML.', confidence: 0.8,
    filesRead: ['src/render.ts'], filesChanged: [], issuesFound: [],
  })

  expect(JSON.parse(session.formatForkContext(['task-a']))).toEqual([{
    taskId: 'task-a', task: 'Inspect parser', summary: 'Parser rejects duplicate keys.', confidence: 0.9,
    filesRead: ['src/parser.ts'], filesChanged: ['src/parser.ts'],
    issuesFound: ['Duplicate keys were silently accepted.'],
  }])
  expect(session.formatForkContext(['missing-task'])).toBe('')
  expect(session.formatForkContext()).toBe('')
  expect(JSON.parse(session.formatForkContext(['task-b', 'task-a'])).map((result: { taskId: string }) => result.taskId)).toEqual(['task-b', 'task-a'])
})

it('bounds retained dependency references', () => {
  const session = new OrchestratorSession({ projectRoot: process.cwd(), logFile: null, snapshotFile: null })
  session.addPreviousResult('task-large', 'Inspect generated sources', {
    summary: 'Large result.', confidence: 0.5,
    filesRead: Array.from({ length: 20 }, (_, index) => `src/file-${index}.ts`),
    filesChanged: [], issuesFound: ['x'.repeat(250)],
  })

  const [result] = JSON.parse(session.formatForkContext(['task-large'])) as Array<{ filesRead: string[]; issuesFound: string[] }>
  expect(result!.filesRead).toHaveLength(12)
  expect(result!.issuesFound[0]).toHaveLength(200)
})

it('caps fork context by serialized UTF-8 bytes and keeps only complete results', () => {
  const session = new OrchestratorSession({ projectRoot: process.cwd(), logFile: null, snapshotFile: null })
  const ids = Array.from({ length: 4 }, (_, index) => `task-${index}`)
  const longText = 'é'.repeat(200)
  for (const taskId of ids) session.addPreviousResult(taskId, `Inspect ${taskId}`, {
    summary: longText, confidence: 0.5,
    filesRead: Array.from({ length: 12 }, (_, index) => `src/${index}-${longText}.ts`),
    filesChanged: [], issuesFound: Array.from({ length: 12 }, () => longText),
  })

  const context = session.formatForkContext(ids)
  const parsed = JSON.parse(context) as Array<{ taskId: string }>
  expect(Buffer.byteLength(context, 'utf8')).toBeLessThanOrEqual(16_000)
  expect(parsed.length).toBeGreaterThan(0)
  expect(parsed.length).toBeLessThan(ids.length)
  expect(parsed.map(result => result.taskId)).toEqual(ids.slice(0, parsed.length))
})
