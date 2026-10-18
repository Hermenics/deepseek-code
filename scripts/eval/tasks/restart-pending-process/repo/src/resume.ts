export interface JobStatus {
  jobId: string
  status: 'running' | 'completed' | 'failed'
  result?: string
}

export interface JobService {
  start(task: string): Promise<{ jobId: string }>
  status(jobId: string): Promise<JobStatus>
  cleanup(jobId: string): Promise<void>
}

export interface JobCheckpoint {
  jobId: string
  task: string
}

export type ResumeResult =
  | { status: 'completed'; jobId: string; result: string }
  | { status: 'incomplete'; jobId: string; reason: string }

export async function resumePendingJob(service: JobService, checkpoint: JobCheckpoint): Promise<ResumeResult> {
  const started = await service.start(checkpoint.task)
  const current = await service.status(started.jobId)
  if (current.status !== 'completed' || current.result === undefined) {
    return { status: 'incomplete', jobId: started.jobId, reason: 'Job is not complete.' }
  }
  await service.cleanup(started.jobId)
  return { status: 'completed', jobId: started.jobId, result: current.result }
}
