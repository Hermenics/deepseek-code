import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm, mkdir, writeFile, access, chmod } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { logout } from '../src/utils/credentials'

let tempDir: string
let configDir: string
let configPath: string
let envPath: string

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'deepseek-logout-test-'))
  configDir = join(tempDir, '.deepseek')
  await mkdir(configDir, { recursive: true })
  configPath = join(configDir, 'config.json')
  envPath = join(configDir, '.env')
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

// ─── logout ─────────────────────────────────────────────────────

describe('logout', () => {
  describe('happy path', () => {
    it('should delete both files when both exist', async () => {
      await writeFile(configPath, JSON.stringify({ model: 'deepseek-chat' }))
      await writeFile(envPath, 'DEEPSEEK_API_KEY=sk-abc123\n')

      await logout(configPath, envPath)

      await expect(access(configPath)).rejects.toThrow()
      await expect(access(envPath)).rejects.toThrow()
    })

    it('should return list of deleted files when both exist', async () => {
      await writeFile(configPath, JSON.stringify({ model: 'deepseek-chat' }))
      await writeFile(envPath, 'DEEPSEEK_API_KEY=sk-abc123\n')

      const deleted = await logout(configPath, envPath)

      expect(deleted).toContain(configPath)
      expect(deleted).toContain(envPath)
      expect(deleted).toHaveLength(2)
    })
  })

  describe('arquivos parciais', () => {
    it('should delete only config.json when only it exists', async () => {
      await writeFile(configPath, JSON.stringify({ model: 'deepseek-chat' }))

      const deleted = await logout(configPath, envPath)

      await expect(access(configPath)).rejects.toThrow()
      expect(deleted).toContain(configPath)
      expect(deleted).not.toContain(envPath)
      expect(deleted).toHaveLength(1)
    })

    it('should delete only .env when only it exists', async () => {
      await writeFile(envPath, 'DEEPSEEK_API_KEY=sk-abc123\n')

      const deleted = await logout(configPath, envPath)

      await expect(access(envPath)).rejects.toThrow()
      expect(deleted).toContain(envPath)
      expect(deleted).not.toContain(configPath)
      expect(deleted).toHaveLength(1)
    })
  })

  describe('nenhum arquivo', () => {
    it('should not throw when neither file exists', async () => {
      const deleted = await logout(configPath, envPath)
      expect(deleted).toEqual([])
    })

    it('should return empty array when neither file exists', async () => {
      const deleted = await logout(configPath, envPath)
      expect(deleted).toEqual([])
    })
  })

  describe('idempotência', () => {
    it('should not throw when called twice in a row', async () => {
      await writeFile(configPath, JSON.stringify({ model: 'deepseek-chat' }))
      await writeFile(envPath, 'DEEPSEEK_API_KEY=sk-abc123\n')

      await logout(configPath, envPath)
      const deleted = await logout(configPath, envPath)

      expect(deleted).toEqual([])
    })

    it('should return empty array on second call', async () => {
      await writeFile(configPath, JSON.stringify({ model: 'deepseek-chat' }))
      await writeFile(envPath, 'DEEPSEEK_API_KEY=sk-abc123\n')

      await logout(configPath, envPath)
      const deleted = await logout(configPath, envPath)

      expect(deleted).toEqual([])
    })
  })

  describe('erro de permissão', () => {
    it('should throw when file exists but cannot be deleted', async () => {
      await writeFile(configPath, '{}')
      await chmod(configDir, 0o444)

      try {
        await expect(logout(configPath, envPath)).rejects.toThrow()
      } finally {
        await chmod(configDir, 0o755)
      }
    })
  })
})
