import { expect, test } from 'bun:test'
import { formatJob } from '../src/job.js'

test('reports jobs that are not complete as running', () => {
  expect(formatJob({ state: 'queued' })).toBe('Job is still running.')
})
