import { execFileSync, type ChildProcess } from 'node:child_process'

export function signalProcessGroupId(id: number, signal: NodeJS.Signals): boolean {
  if (process.platform === 'win32' || !Number.isSafeInteger(id) || id < 2) return false
  try { process.kill(-id, signal); return true }
  catch (error) {
    if (['ESRCH', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '')) return false
    throw error
  }
}

export function signalProcessGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid && process.platform !== 'win32') {
    if (!signalProcessGroupId(child.pid, signal)) child.kill(signal)
  } else if (child.pid && process.platform === 'win32') {
    try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', timeout: 1000 }) }
    catch { child.kill(signal) }
  } else child.kill(signal)
}
