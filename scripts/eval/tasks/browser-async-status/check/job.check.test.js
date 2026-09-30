import { expect, test } from 'bun:test'
import { formatJob } from '../src/job.js'

test('uses the API status field to recognize completed jobs', () => {
  expect(formatJob({ status: 'complete', reference: 'JOB-123' })).toBe('Job complete · JOB-123')
})
