import { execFileSync, type ChildProcess } from 'node:child_process'

export function signalProcessGroupId(id: number, signal: NodeJS.Signals): boolean {
  if (process.platform === 'win32' || !Number.isSafeInteger(id) || id < 2) return false
  try { process.kill(-id, signal); return true }
  catch (error) {
    if (['ESRCH', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '')) return false
    throw error
  }
}

export function signalProcessGroup(child: ChildProcess, signal: NodeJS.Signals): boolean {
  if (child.pid && process.platform !== 'win32') {
    if (signalProcessGroupId(child.pid, signal)) return true
    return child.kill(signal)
  } else if (child.pid && process.platform === 'win32') {
    const trace = (stage: string) => {
      if (process.env.DEEPSEEK_PROCESS_KILL_TRACE === '1') console.error(`[process-kill] ${child.pid} ${stage}`)
    }
    try {
      trace('taskkill:start')
      execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', timeout: 5000 })
      trace('taskkill:success')
      return true
    } catch (error) {
      trace(`taskkill:failed:${(error as NodeJS.ErrnoException).code ?? (error as Error).message}`)
      const killed = child.kill(signal)
      trace(`child.kill:${killed}`)
      return killed
    }
  }
  return child.kill(signal)
}
