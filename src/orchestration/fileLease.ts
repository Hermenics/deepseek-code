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

async function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw abortError(signal)
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); resolve() }, ms)
    const cancel = () => { clearTimeout(timer); cleanup(); reject(abortError(signal!)) }
    const cleanup = () => signal?.removeEventListener('abort', cancel)
    signal?.addEventListener('abort', cancel, { once: true })
  })
}

function processAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try { process.kill(pid, 0); return true } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

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
      return {
        token,
        path,
        async release() {
          if (released) return
          released = true
          const current = JSON.parse(await readFile(join(path, 'owner.json'), 'utf8').catch(() => '{}')) as Partial<LeaseOwner>
          if (current.token !== token) return
          await moveAside(path, 'released')
        },
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      if (await reclaimIfStale(path)) continue
      await delay(25, signal)
    }
  }
}
