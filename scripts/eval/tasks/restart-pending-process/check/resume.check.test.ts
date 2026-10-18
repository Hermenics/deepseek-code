import { expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
const taskRoot = existsSync(join(process.cwd(), 'src/resume.ts')) ? process.cwd() : join(import.meta.dir, '../repo')
const { resumePendingJob } = await import(join(taskRoot, 'src/resume.ts'))

type JobStatus = { jobId: string; status: 'running' | 'completed' | 'failed'; result?: string }
type JobCheckpoint = { jobId: string; task: string }
type JobService = {
  start(task: string): Promise<{ jobId: string }>
  status(jobId: string): Promise<JobStatus>
  cleanup(jobId: string): Promise<void>
}

class RestartedJobService implements JobService {
  readonly jobs = new Map<string, JobStatus>([['job-17', { jobId: 'job-17', status: 'running' }]])
  readonly statusQueries: string[] = []
  readonly cleaned: string[] = []
  readonly started: string[] = []
  private readonly polls = new Map<string, number>()

  async start(task: string): Promise<{ jobId: string }> {
    const jobId = `duplicate-${this.started.length + 1}`
    this.started.push(task)
    this.jobs.set(jobId, { jobId, status: 'running' })
    return { jobId }
  }

  async status(jobId: string): Promise<JobStatus> {
    this.statusQueries.push(jobId)
    const job = this.jobs.get(jobId)
    if (!job) return { jobId, status: 'failed' }
    const poll = (this.polls.get(jobId) ?? 0) + 1
    this.polls.set(jobId, poll)
    if (jobId === 'job-17' && poll >= 2) {
      const completed = { jobId, status: 'completed' as const, result: 'persisted-result:job-17' }
      this.jobs.set(jobId, completed)
      return completed
    }
    if (jobId !== 'job-17' && poll >= 2) {
      return { jobId, status: 'completed', result: `duplicate-result:${jobId}` }
    }
    return job
  }

  async cleanup(jobId: string): Promise<void> {
    this.cleaned.push(jobId)
    this.jobs.delete(jobId)
  }
}

const checkpoint = JSON.parse(readFileSync(join(taskRoot, 'data/checkpoint.json'), 'utf8')) as JobCheckpoint

it('resumes the saved job, returns its completed result, and cleans up without duplicates', async () => {
  const service = new RestartedJobService()
  const result = await resumePendingJob(service, checkpoint)
  expect(service.started).toEqual([])
  expect(service.statusQueries).toEqual(['job-17', 'job-17'])
  expect(result).toEqual({ status: 'completed', jobId: 'job-17', result: 'persisted-result:job-17' })
  expect(service.cleaned).toEqual(['job-17'])
  expect(service.jobs.size).toBe(0)
})

it('does not invent a result or mark a non-completed persisted job successful', async () => {
  const service = new RestartedJobService()
  service.status = async (jobId: string) => ({ jobId, status: 'running' })
  const result = await resumePendingJob(service, checkpoint)
  expect(result.status).toBe('incomplete')
  expect(result).not.toHaveProperty('result')
})
