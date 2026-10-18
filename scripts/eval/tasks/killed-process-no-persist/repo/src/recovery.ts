export interface ExecutionSnapshot {
  id: string
  status: 'running' | 'timed_out' | 'failed' | 'completed'
  stdout: string
  artifactPath?: string
}

export type RecoveryResult =
  | { status: 'completed'; result: string; artifactPath: string }
  | { status: 'incomplete'; reason: string }

export function recoverExecution(
  execution: ExecutionSnapshot,
  readArtifact: (path: string) => string | null,
): RecoveryResult {
  if (execution.stdout.trim()) {
    return { status: 'completed', result: execution.stdout.trim(), artifactPath: execution.artifactPath ?? '' }
  }
  return { status: 'incomplete', reason: 'No output was produced.' }
}
