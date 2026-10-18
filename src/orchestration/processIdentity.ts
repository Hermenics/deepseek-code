import type { ChildProcess } from 'node:child_process'
import { closeSync, openSync, readSync, readlinkSync, readdirSync } from 'node:fs'

export interface ProcessIdentity {
  platform: 'linux'
  pid: number
  bootId: string
  pidNamespace: string
  startTimeTicks: string
  sessionId?: number
  processGroupId?: number
}
export interface ProcessGroupObservation {
  id: number
  status: 'alive' | 'exited' | 'unknown'
  observedAt: string
  memberCount?: number
  reason?: string
}
export interface ProcessObservation {
  identity?: ProcessIdentity
  processGroup?: ProcessGroupObservation
  status: 'alive' | 'exited' | 'identity-mismatch' | 'unknown'
  observedAt: string
  provenance: 'kernel' | 'child-event' | 'unavailable'
  scope: 'leader-only' | 'process-group'
  progress: 'not-measured'
  reason?: string
  exitCode?: number | null
  signal?: string | null
}

function readBounded(path: string): string {
  const file = openSync(path, 'r')
  try {
    const bytes = Buffer.alloc(4097)
    let count = 0
    while (count < bytes.length) {
      const length = readSync(file, bytes, count, bytes.length - count, null)
      if (!length) break
      count += length
    }
    if (count > 4096) throw new Error('Process identity exceeds its byte limit')
    return bytes.subarray(0, count).toString('utf8').trim()
  } finally { closeSync(file) }
}

/** comm may contain spaces and parentheses; the numeric fields follow its final closing parenthesis. */
export function parseLinuxProcessStat(value: string, pid: number) {
  const end = value.lastIndexOf(')')
  const start = value.indexOf('(')
  const fields = value.slice(end + 1).trim().split(/\s+/)
  if (!Number.isSafeInteger(pid) || pid < 1 || start < 1 || end <= start || value.slice(0, start).trim() !== String(pid)
    || !/^[A-Za-z]$/.test(fields[0] ?? '') || !/^\d+$/.test(fields[2] ?? '') || !/^\d+$/.test(fields[3] ?? '')
    || !/^\d+$/.test(fields[19] ?? '')) throw new Error('Invalid process identity')
  return { state: fields[0]!, processGroupId: Number(fields[2]), sessionId: Number(fields[3]), startTimeTicks: fields[19]! }
}

function pidNamespace(): string {
  const value = readlinkSync('/proc/self/ns/pid')
  if (!/^pid:\[[0-9]+\]$/.test(value)) throw new Error('Invalid PID namespace identity')
  return value
}

function bootId(): string {
  const value = readBounded('/proc/sys/kernel/random/boot_id')
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)) throw new Error('Invalid boot identity')
  return value
}

export function observeProcess(previous: ProcessObservation): ProcessObservation {
  const observation: ProcessObservation = { ...previous, observedAt: new Date().toISOString(), status: 'unknown', provenance: 'unavailable' }
  const identity = previous.identity
  if (!identity && previous.provenance === 'child-event') return structuredClone(previous)
  if (process.platform !== 'linux' || !identity || identity.platform !== 'linux' || !Number.isSafeInteger(identity.pid) || identity.pid < 1) return { ...observation, reason: 'identity-unavailable' }
  const groupId = identity.processGroupId === identity.pid ? identity.processGroupId : undefined
  const scoped = { ...observation, scope: groupId ? 'process-group' as const : 'leader-only' as const }
  try {
    if (bootId() !== identity.bootId) {
      const exitedGroup = groupId ? { id: groupId, status: 'exited' as const, observedAt: observation.observedAt, memberCount: 0, reason: 'different-boot' } : undefined
      return previous.provenance === 'child-event'
        ? { ...previous, scope: scoped.scope, processGroup: exitedGroup, observedAt: observation.observedAt }
        : { ...scoped, status: 'identity-mismatch', provenance: 'kernel', reason: 'different-boot', processGroup: exitedGroup }
    }
    if (pidNamespace() !== identity.pidNamespace) {
      const unavailableGroup = groupId ? { id: groupId, status: 'unknown' as const, observedAt: observation.observedAt, reason: 'different-pid-namespace' } : undefined
      return previous.provenance === 'child-event'
        ? { ...previous, scope: scoped.scope, processGroup: unavailableGroup, observedAt: observation.observedAt }
        : { ...scoped, reason: 'different-pid-namespace', processGroup: unavailableGroup }
    }
  } catch {
    const unavailableGroup = groupId ? { id: groupId, status: 'unknown' as const, observedAt: observation.observedAt, reason: 'observation-unavailable' } : undefined
    return previous.provenance === 'child-event'
      ? { ...previous, scope: scoped.scope, processGroup: unavailableGroup, observedAt: observation.observedAt }
      : { ...scoped, reason: 'observation-unavailable', processGroup: unavailableGroup }
  }

  let leader = previous.provenance === 'child-event'
    ? { ...previous, scope: scoped.scope, observedAt: observation.observedAt }
    : scoped
  let leaderOwnsGroup = false
  if (previous.provenance !== 'child-event') {
    try {
      const current = parseLinuxProcessStat(readBounded(`/proc/${identity.pid}/stat`), identity.pid)
      if (current.startTimeTicks !== identity.startTimeTicks || identity.sessionId !== undefined && current.sessionId !== identity.sessionId) {
        leader = { ...leader, status: 'identity-mismatch', provenance: 'kernel', reason: 'different-process' }
      }
      else {
        leader = { ...leader, status: /^[ZXx]$/.test(current.state) ? 'exited' : 'alive', provenance: 'kernel', reason: undefined }
        leaderOwnsGroup = !!groupId && current.processGroupId === groupId && !/^[ZXx]$/.test(current.state)
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' || (error as NodeJS.ErrnoException).code === 'ESRCH') leader = { ...leader, status: 'exited', provenance: 'kernel', reason: 'leader-absent' }
      else leader = { ...leader, reason: 'observation-unavailable' }
    }
  }
  if (!groupId) return leader
  return { ...leader, processGroup: observeProcessGroup(groupId, identity.sessionId, leaderOwnsGroup) }
}

/** Liveness covers descendants only when the tracked child owns a new process group. */
function observeProcessGroup(id: number, sessionId: number | undefined, leaderOwnsGroup: boolean): ProcessGroupObservation {
  const observedAt = new Date().toISOString()
  if (leaderOwnsGroup) return { id, status: 'alive', observedAt }
  try {
    const pids = readdirSync('/proc').filter(entry => /^\d+$/.test(entry))
    if (pids.length > 100_000) return { id, status: 'unknown', observedAt, reason: 'proc-entry-limit' }
    let memberCount = 0
    for (const value of pids) {
      const pid = Number(value)
      try {
        const current = parseLinuxProcessStat(readBounded(`/proc/${pid}/stat`), pid)
        if (current.processGroupId === id && (sessionId === undefined || current.sessionId === sessionId) && !/^[ZXx]$/.test(current.state)) memberCount++
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code !== 'ENOENT' && code !== 'ESRCH') return { id, status: 'unknown', observedAt, reason: 'member-observation-unavailable' }
      }
    }
    return { id, status: memberCount ? 'alive' : 'exited', observedAt, memberCount }
  } catch {
    return { id, status: 'unknown', observedAt, reason: 'proc-scan-unavailable' }
  }
}

/** Unknown ownership is treated as active so a task cannot claim completion without evidence that its child settled. */
export function isProcessActive(observation: ProcessObservation): boolean {
  if (observation.scope === 'process-group') return observation.processGroup?.status !== 'exited'
  return observation.status !== 'exited' && observation.status !== 'identity-mismatch'
}

/** Capture an observed PID without treating liveness as execution progress. */
export function captureProcessId(pid: number): ProcessObservation {
  const observation: ProcessObservation = { status: 'unknown', observedAt: new Date().toISOString(), provenance: 'unavailable', scope: 'leader-only', progress: 'not-measured', reason: 'identity-unavailable' }
  if (process.platform !== 'linux' || !Number.isSafeInteger(pid) || pid < 1) return observation
  try {
    const current = parseLinuxProcessStat(readBounded(`/proc/${pid}/stat`), pid)
    const identity: ProcessIdentity = { platform: 'linux', pid, bootId: bootId(), pidNamespace: pidNamespace(), startTimeTicks: current.startTimeTicks, sessionId: current.sessionId, processGroupId: current.processGroupId }
    return observeProcess({ ...observation, scope: identity.processGroupId === identity.pid ? 'process-group' : 'leader-only', identity })
  } catch { return observation }
}

/** Capture only a native ChildProcess; no process is discovered, signalled or restarted by this observer. */
export function captureProcess(child: ChildProcess): ProcessObservation {
  return child.pid ? captureProcessId(child.pid) : { status: 'unknown', observedAt: new Date().toISOString(), provenance: 'unavailable', scope: 'leader-only', progress: 'not-measured', reason: 'identity-unavailable' }
}

/** Capture the calling process for an owned supervisor record. */
export function captureCurrentProcess(): ProcessObservation {
  return captureProcessId(process.pid)
}
