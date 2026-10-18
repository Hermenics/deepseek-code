import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

interface LeaseOwner {
  token: string
  pid: number
  createdAt: string
  resource: string
  metadata: Record<string, unknown>
}

export interface FileLease {
  readonly token: string
  readonly path: string
  release(): Promise<void>
}

const LEASE_ROOT = join(tmpdir(), 'deepseek-code-leases-v1')

function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new Error('Lease acquisition cancelled')
}

/** Sleep for `ms`, rejecting early with the signal's reason when it aborts. */
async function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw abortError(signal)
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); resolve() }, ms)
    const cancel = () => { clearTimeout(timer); cleanup(); reject(abortError(signal!)) }
    const cleanup = () => signal?.removeEventListener('abort', cancel)
    signal?.addEventListener('abort', cancel, { once: true })
  })
}

/** Probe a PID with signal 0; only ESRCH counts as dead (EPERM means the process exists). */
function processAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try { process.kill(pid, 0); return true } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

/** Atomically rename a lease directory to a unique quarantine name, then delete it. Returns false if it was already gone. */
async function moveAside(path: string, label: string): Promise<boolean> {
  const quarantine = `${path}.${label}-${randomUUID()}`
  try {
    await rename(path, quarantine)
  } catch (error) {
    if (['ENOENT', 'EEXIST'].includes((error as NodeJS.ErrnoException).code ?? '')) return false
    throw error
  }
  await rm(quarantine, { recursive: true, force: true })
  return true
}

/** Remove a lease whose owner process is dead. A lease with a missing or unreadable owner.json is only reclaimed after 30s, giving a new owner time to finish writing it. */
async function reclaimIfStale(path: string): Promise<boolean> {
  try {
    const owner = JSON.parse(await readFile(join(path, 'owner.json'), 'utf8')) as Partial<LeaseOwner>
    if (typeof owner.pid === 'number' && processAlive(owner.pid)) return false
    return moveAside(path, 'stale')
  } catch (error) {
    const details = await stat(path).catch(() => undefined)
    if (!details || Date.now() - details.mtimeMs < 30_000) return false
    return moveAside(path, (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'incomplete' : 'invalid')
  }
}

/** Cross-session/process lease backed by an atomic directory on the local host. */
export async function acquireFileLease(
  resource: string,
  metadata: Record<string, unknown> = {},
  signal?: AbortSignal,
): Promise<FileLease> {
  if (signal?.aborted) throw abortError(signal)
  await mkdir(LEASE_ROOT, { recursive: true, mode: 0o700 })
  const digest = createHash('sha256').update(resource).digest('hex')
  const path = join(LEASE_ROOT, digest)
  const token = randomUUID()
  const owner: LeaseOwner = { token, pid: process.pid, createdAt: new Date().toISOString(), resource, metadata }

  while (true) {
    try {
      await mkdir(path, { mode: 0o700 })
      try {
        await writeFile(join(path, 'owner.json'), `${JSON.stringify(owner)}\n`, { encoding: 'utf8', mode: 0o600 })
      } catch (error) {
        await moveAside(path, 'incomplete').catch(() => false)
        throw error
      }
      let released = false
      let releaseInFlight: Promise<void> | undefined
      const releaseOnce = async (): Promise<void> => {
        if (released) return
        let current: Partial<LeaseOwner>
        try {
          current = JSON.parse(await readFile(join(path, 'owner.json'), 'utf8')) as Partial<LeaseOwner>
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
          try {
            await stat(path)
          } catch (directoryError) {
            if ((directoryError as NodeJS.ErrnoException).code !== 'ENOENT') throw directoryError
            released = true
            return
          }
          throw error
        }
        if (current.token !== token) {
          released = true
          return
        }

        try {
          if (await moveAside(path, 'released')) {
            released = true
            return
          }
        } catch (error) {
          try {
            await stat(path)
          } catch (directoryError) {
            if ((directoryError as NodeJS.ErrnoException).code !== 'ENOENT') throw directoryError
            released = true
            return
          }
          throw error
        }

        try {
          await stat(path)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
          released = true
          return
        }
        throw new Error('Lease directory could not be moved aside')
      }
      return {
        token,
        path,
        release() {
          if (released) return Promise.resolve()
          if (releaseInFlight) return releaseInFlight
          let attempt: Promise<void>
          attempt = releaseOnce().finally(() => {
            if (releaseInFlight === attempt) releaseInFlight = undefined
          })
          releaseInFlight = attempt
          return attempt
        },
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      if (await reclaimIfStale(path)) continue
      await delay(25, signal)
    }
  }
}
