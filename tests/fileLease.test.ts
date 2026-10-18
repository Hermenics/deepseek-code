import { randomUUID } from 'node:crypto'
import { readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'bun:test'
import { acquireFileLease, type FileLease } from '../src/orchestration/fileLease.js'

describe('file lease release', () => {
  it('coalesces concurrent releases so a replacement lease remains owned', async () => {
    const resource = `file-lease-release-concurrent:${randomUUID()}`
    const lease = await acquireFileLease(resource)
    let replacement: FileLease | undefined
    const firstRelease = lease.release()
    const secondRelease = lease.release()

    try {
      expect(secondRelease).toBe(firstRelease)
      replacement = await acquireFileLease(resource)
      await Promise.all([firstRelease, secondRelease])
      const owner = JSON.parse(await readFile(join(replacement.path, 'owner.json'), 'utf8')) as { token: string }
      expect(owner.token).toBe(replacement.token)
    } finally {
      await replacement?.release().catch(() => {})
      await firstRelease.catch(() => {})
      await lease.release().catch(() => {})
      await rm(lease.path, { recursive: true, force: true })
    }
  })

  it('can retry release after a temporary missing owner file', async () => {
    const resource = `file-lease-release-retry:${randomUUID()}`
    const lease = await acquireFileLease(resource)
    let reacquired: FileLease | undefined
    const ownerPath = join(lease.path, 'owner.json')
    const owner = await readFile(ownerPath, 'utf8')

    try {
      await rm(ownerPath)
      try {
        await expect(lease.release()).rejects.toMatchObject({ code: 'ENOENT' })
      } finally {
        await writeFile(ownerPath, owner, { encoding: 'utf8', mode: 0o600 })
      }

      await lease.release()
      await expect(stat(lease.path)).rejects.toMatchObject({ code: 'ENOENT' })
      reacquired = await acquireFileLease(resource)
      expect(reacquired.token).not.toBe(lease.token)
    } finally {
      await reacquired?.release().catch(() => {})
      await lease.release().catch(() => {})
      await rm(lease.path, { recursive: true, force: true })
    }
  })
})
