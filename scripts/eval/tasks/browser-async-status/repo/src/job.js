/** Formats a job returned by the monitor endpoint. */
export function formatJob(job) {
  return job.state === 'complete' ? `Job complete · ${job.reference}` : 'Job is still running.'
}
