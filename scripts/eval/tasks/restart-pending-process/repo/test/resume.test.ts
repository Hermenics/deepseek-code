import { expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { resumePendingJob, type JobCheckpoint, type JobService, type JobStatus } from '../src/resume'

const checkpoint = JSON.parse(readFileSync(join(import.meta.dir, '../data/checkpoint.json'), 'utf8')) as JobCheckpoint

it('polls the persisted job and cleans up after returning its result', async () => {
  const queries: string[] = []
  const cleaned: string[] = []
  const service: JobService = {
    async start() { throw new Error('resume must not start another job') },
    async status(jobId): Promise<JobStatus> {
      queries.push(jobId)
      return queries.length === 1
        ? { jobId, status: 'running' }
        : { jobId, status: 'completed', result: 'persisted result' }
    },
    async cleanup(jobId) { cleaned.push(jobId) },
  }
  expect(await resumePendingJob(service, checkpoint)).toEqual({
    status: 'completed', jobId: checkpoint.jobId, result: 'persisted result',
  })
  expect(queries).toEqual([checkpoint.jobId, checkpoint.jobId])
  expect(cleaned).toEqual([checkpoint.jobId])
})
