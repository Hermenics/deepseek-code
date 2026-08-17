import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

let testDir: string

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), 'dsk-checkpoint-test-'))
  process.env.HOME = testDir
})

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true })
})

async function getModule() {
  const mod = await import('../src/agent/checkpoint.js')
  return mod
}

describe('checkpoint', () => {
  describe('saveCheckpoint', () => {
    it('should return a string ID', async () => {
      const { saveCheckpoint } = await getModule()
      const messages = [{ role: 'system' as const, content: 'test' }]
      const id = await saveCheckpoint(messages, [])
      expect(typeof id).toBe('string')
      expect(id).toMatch(/^\d+-[a-f0-9]{6}$/)
    })

    it('should return unique IDs for consecutive saves', async () => {
      const { saveCheckpoint } = await getModule()
      const messages = [{ role: 'system' as const, content: 'test' }]
      const id1 = await saveCheckpoint(messages, [])
      await new Promise(r => setTimeout(r, 5))
      const id2 = await saveCheckpoint(messages, [])
      expect(id1).not.toBe(id2)
    })

    it('should save with custom label', async () => {
      const { saveCheckpoint, loadCheckpoint } = await getModule()
      const messages = [{ role: 'system' as const, content: 'test' }]
      const id = await saveCheckpoint(messages, ['file1.ts'], 'meu checkpoint')
      const loaded = await loadCheckpoint(id)
      expect(loaded).not.toBeNull()
      expect(loaded!.label).toBe('meu checkpoint')
    })

    it('should preserve messages and filesModified', async () => {
      const { saveCheckpoint, loadCheckpoint } = await getModule()
      const messages = [
        { role: 'system' as const, content: 'system prompt' },
        { role: 'user' as const, content: 'hello' },
      ]
      const files = ['/src/index.ts', '/src/agent.ts']
      const id = await saveCheckpoint(messages, files)
      const loaded = await loadCheckpoint(id)
      expect(loaded!.messages).toEqual(messages)
      expect(loaded!.filesModified).toEqual(files)
    })
  })

  describe('loadCheckpoint', () => {
    it('should return null for non-existent checkpoint', async () => {
      const { loadCheckpoint } = await getModule()
      const result = await loadCheckpoint('non-existent-id-12345')
      expect(result).toBeNull()
    })

    it('should load a previously saved checkpoint', async () => {
      const { saveCheckpoint, loadCheckpoint } = await getModule()
      const messages = [{ role: 'system' as const, content: 'test' }]
      const id = await saveCheckpoint(messages, [])
      const loaded = await loadCheckpoint(id)
      expect(loaded).not.toBeNull()
      expect(loaded!.id).toBe(id)
      expect(loaded!.messages).toEqual(messages)
    })

    it('should reject checkpoint IDs that escape the checkpoint directory', async () => {
      const { loadCheckpoint } = await getModule()
      await mkdir(join(testDir, '.deepseek'), { recursive: true })
      await writeFile(join(testDir, '.deepseek', 'outside.json'), JSON.stringify({ id: 'outside' }))
      expect(await loadCheckpoint('../outside')).toBeNull()
    })
  })

  describe('listCheckpoints', () => {
    it('should return array', async () => {
      const { listCheckpoints } = await getModule()
      const result = await listCheckpoints()
      expect(result).toBeArray()
    })

    it('should include recently saved checkpoints', async () => {
      const { saveCheckpoint, listCheckpoints } = await getModule()
      const messages = [{ role: 'system' as const, content: 'list test' }]
      const id = await saveCheckpoint(messages, [], 'list-test-label')
      const list = await listCheckpoints()
      const found = list.find(cp => cp.id === id)
      expect(found).toBeDefined()
      expect(found!.label).toBe('list-test-label')
    })

    it('should return checkpoints in reverse chronological order', async () => {
      const { saveCheckpoint, listCheckpoints } = await getModule()
      const messages = [{ role: 'system' as const, content: 'test' }]
      const id1 = await saveCheckpoint(messages, [], 'first')
      await new Promise(r => setTimeout(r, 5))
      const id2 = await saveCheckpoint(messages, [], 'second')
      const list = await listCheckpoints()
      const idx1 = list.findIndex(cp => cp.id === id1)
      const idx2 = list.findIndex(cp => cp.id === id2)
      expect(idx2).toBeLessThan(idx1)
    })
  })
})
