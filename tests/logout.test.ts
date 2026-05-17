import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm, mkdir, writeFile, access, chmod } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { logout } from '../src/utils/credentials'

let tempDir: string
let configDir: string
let configPath: string

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'deepseek-logout-test-'))
  configDir = join(tempDir, '.deepseek')
  await mkdir(configDir, { recursive: true })
  configPath = join(configDir, 'config.json')
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

// ─── logout ─────────────────────────────────────────────────────

describe('logout', () => {
  describe('happy path', () => {
    it('should delete config.json when it exists', async () => {
      await writeFile(configPath, JSON.stringify({ model: 'deepseek-chat' }))

      await logout(configPath)

      await expect(access(configPath)).rejects.toThrow()
    })

    it('should return list of deleted files', async () => {
      await writeFile(configPath, JSON.stringify({ model: 'deepseek-chat' }))

      const deleted = await logout(configPath)

      expect(deleted).toContain(configPath)
    })
  })

  describe('nenhum arquivo', () => {
    it('should not throw when file does not exist', async () => {
      const deleted = await logout(configPath)
      expect(deleted).toEqual([])
    })

    it('should return empty array when file does not exist', async () => {
      const deleted = await logout(configPath)
      expect(deleted).toEqual([])
    })
  })

  describe('idempotência', () => {
    it('should not throw when called twice in a row', async () => {
      await writeFile(configPath, JSON.stringify({ model: 'deepseek-chat' }))

      await logout(configPath)
      const deleted = await logout(configPath)

      expect(deleted).toEqual([])
    })

    it('should return empty array on second call', async () => {
      await writeFile(configPath, JSON.stringify({ model: 'deepseek-chat' }))

      await logout(configPath)
      const deleted = await logout(configPath)

      expect(deleted).toEqual([])
    })
  })

  describe('erro de permissão', () => {
    it('should throw when file exists but cannot be deleted', async () => {
      await writeFile(configPath, '{}')
      await chmod(configDir, 0o444)

      try {
        await expect(logout(configPath)).rejects.toThrow()
      } finally {
        await chmod(configDir, 0o755)
      }
    })
  })
})
