import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

let testDir: string
let testSessionId: string

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), 'dsk-filecheckpoint-test-'))
  process.env.HOME = testDir
  testSessionId = `test-session-${Date.now()}`
})

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true })
})

async function getModule() {
  return await import('../src/agent/fileCheckpoint.js')
}

describe('fileCheckpoint', () => {
  describe('createFileCheckpoint', () => {
    it('should create a backup of an existing file', async () => {
      const { createFileCheckpoint, listFileCheckpoints } = await getModule()
      const targetFile = join(testDir, 'target.ts')
      await writeFile(targetFile, 'original content', 'utf-8')

      await createFileCheckpoint(testSessionId, targetFile, 'write_file')

      const entries = await listFileCheckpoints(testSessionId)
      expect(entries.length).toBe(1)
      expect(entries[0]!.path).toBe(targetFile)
      expect(entries[0]!.toolName).toBe('write_file')
    })

    it('should handle non-existent files (new file scenario)', async () => {
      const { createFileCheckpoint, listFileCheckpoints } = await getModule()
      const targetFile = join(testDir, 'new-file.ts')

      await createFileCheckpoint(testSessionId, targetFile, 'write_file')

      const entries = await listFileCheckpoints(testSessionId)
      expect(entries.length).toBe(1)
      expect(entries[0]!.path).toBe(targetFile)
    })

    it('should create multiple checkpoints for same file', async () => {
      const { createFileCheckpoint, listFileCheckpoints } = await getModule()
      const targetFile = join(testDir, 'target.ts')
      await writeFile(targetFile, 'v1', 'utf-8')
      await createFileCheckpoint(testSessionId, targetFile, 'write_file')

      await writeFile(targetFile, 'v2', 'utf-8')
      await createFileCheckpoint(testSessionId, targetFile, 'patch_file')

      const entries = await listFileCheckpoints(testSessionId)
      expect(entries.length).toBe(2)
    })
  })

  describe('rollbackLast', () => {
    it('should restore the last modified file', async () => {
      const { createFileCheckpoint, rollbackLast } = await getModule()
      const targetFile = join(testDir, 'target.ts')
      await writeFile(targetFile, 'original', 'utf-8')

      await createFileCheckpoint(testSessionId, targetFile, 'write_file')
      await writeFile(targetFile, 'modified', 'utf-8')

      const result = await rollbackLast(testSessionId)
      expect(result).toContain('Restored')

      const content = await readFile(targetFile, 'utf-8')
      expect(content).toBe('original')
    })

    it('should delete file if it did not exist before', async () => {
      const { createFileCheckpoint, rollbackLast } = await getModule()
      const targetFile = join(testDir, 'new-file.ts')

      await createFileCheckpoint(testSessionId, targetFile, 'write_file')
      await writeFile(targetFile, 'new content', 'utf-8')

      await rollbackLast(testSessionId)

      const exists = await readFile(targetFile, 'utf-8').then(() => true).catch(() => false)
      expect(exists).toBe(false)
    })

    it('should return message when nothing to rollback', async () => {
      const { rollbackLast } = await getModule()
      const result = await rollbackLast(testSessionId)
      expect(result).toBe('Nothing to rollback.')
    })

    it('should rollback in LIFO order', async () => {
      const { createFileCheckpoint, rollbackLast } = await getModule()
      const file1 = join(testDir, 'file1.ts')
      const file2 = join(testDir, 'file2.ts')
      await writeFile(file1, 'original1', 'utf-8')
      await writeFile(file2, 'original2', 'utf-8')

      await createFileCheckpoint(testSessionId, file1, 'write_file')
      await writeFile(file1, 'modified1', 'utf-8')

      await createFileCheckpoint(testSessionId, file2, 'patch_file')
      await writeFile(file2, 'modified2', 'utf-8')

      const result1 = await rollbackLast(testSessionId)
      expect(result1).toContain('file2.ts')
      expect(await readFile(file2, 'utf-8')).toBe('original2')
      expect(await readFile(file1, 'utf-8')).toBe('modified1')

      const result2 = await rollbackLast(testSessionId)
      expect(result2).toContain('file1.ts')
      expect(await readFile(file1, 'utf-8')).toBe('original1')
    })
  })

  describe('rollbackAll', () => {
    it('should restore all modified files', async () => {
      const { createFileCheckpoint, rollbackAll } = await getModule()
      const file1 = join(testDir, 'file1.ts')
      const file2 = join(testDir, 'file2.ts')
      await writeFile(file1, 'original1', 'utf-8')
      await writeFile(file2, 'original2', 'utf-8')

      await createFileCheckpoint(testSessionId, file1, 'write_file')
      await writeFile(file1, 'modified1', 'utf-8')

      await createFileCheckpoint(testSessionId, file2, 'write_file')
      await writeFile(file2, 'modified2', 'utf-8')

      const result = await rollbackAll(testSessionId)
      expect(result).toContain('Restored 2 file(s)')

      expect(await readFile(file1, 'utf-8')).toBe('original1')
      expect(await readFile(file2, 'utf-8')).toBe('original2')
    })

    it('should return message when nothing to rollback', async () => {
      const { rollbackAll } = await getModule()
      const result = await rollbackAll(testSessionId)
      expect(result).toBe('Nothing to rollback.')
    })

    it('should handle mixed existing and new files', async () => {
      const { createFileCheckpoint, rollbackAll } = await getModule()
      const existing = join(testDir, 'existing.ts')
      const newFile = join(testDir, 'new.ts')
      await writeFile(existing, 'original', 'utf-8')

      await createFileCheckpoint(testSessionId, existing, 'write_file')
      await writeFile(existing, 'modified', 'utf-8')

      await createFileCheckpoint(testSessionId, newFile, 'write_file')
      await writeFile(newFile, 'new content', 'utf-8')

      await rollbackAll(testSessionId)

      expect(await readFile(existing, 'utf-8')).toBe('original')
      const newExists = await readFile(newFile, 'utf-8').then(() => true).catch(() => false)
      expect(newExists).toBe(false)
    })
  })

  describe('listFileCheckpoints', () => {
    it('should return empty array for new session', async () => {
      const { listFileCheckpoints } = await getModule()
      const entries = await listFileCheckpoints(testSessionId)
      expect(entries).toBeArray()
      expect(entries.length).toBe(0)
    })

    it('should return entries in reverse chronological order', async () => {
      const { createFileCheckpoint, listFileCheckpoints } = await getModule()
      const file1 = join(testDir, 'file1.ts')
      const file2 = join(testDir, 'file2.ts')
      await writeFile(file1, 'content1', 'utf-8')
      await writeFile(file2, 'content2', 'utf-8')

      await createFileCheckpoint(testSessionId, file1, 'write_file')
      await new Promise(r => setTimeout(r, 5))
      await createFileCheckpoint(testSessionId, file2, 'patch_file')

      const entries = await listFileCheckpoints(testSessionId)
      expect(entries[0]!.path).toBe(file2)
      expect(entries[1]!.path).toBe(file1)
    })
  })

  describe('session management', () => {
    it('should set and get session id', async () => {
      const { setCheckpointSession, getCheckpointSession } = await getModule()
      setCheckpointSession('my-session-123')
      expect(getCheckpointSession()).toBe('my-session-123')
    })
  })
})
