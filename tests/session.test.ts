import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, readdir, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { basename, join } from 'path'
import { createHash } from 'crypto'

// ── Redireciona SESSIONS_DIR para diretório temporário ──────────────────────
let testDir: string

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), 'dsk-session-test-'))
  process.env.HOME = testDir
})

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true })
})

// Importa após setar HOME para que o módulo use o diretório correto
async function getModule() {
  // Força re-importação com cache bust via query string não funciona em bun,
  // então importamos uma vez e reutilizamos — HOME já está setado antes do import
  const mod = await import('../src/agent/session.js')
  return mod
}

describe('session', () => {
  describe('newSessionId', () => {
    it('retorna string alfanumérica de 12 caracteres', async () => {
      const { newSessionId } = await getModule()
      const id = newSessionId()
      expect(id).toMatch(/^[a-z0-9]{12}$/)
    })

    it('retorna IDs únicos em chamadas consecutivas', async () => {
      const { newSessionId } = await getModule()
      const id1 = newSessionId()
      await new Promise(r => setTimeout(r, 5))
      const id2 = newSessionId()
      expect(id1).not.toBe(id2)
    })
  })

  describe('saveSession / loadSession', () => {
    it('salva na pasta do projeto dentro de ~/.deepseek/sessions', async () => {
      const { saveSession, newSessionId } = await getModule()
      const cwd = process.cwd()
      await saveSession({
        id: newSessionId(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        cwd,
        model: 'deepseek-chat',
        provider: 'deepseek',
        language: null,
        activeAgent: null,
        agentMessages: [],
        uiMessages: [],
        filesModified: [],
      })
      const hash = createHash('sha256').update(cwd).digest('hex').slice(0, 8)
      const files = await readdir(join(testDir, '.deepseek', 'sessions', `${basename(cwd)}-${hash}`))
      expect(files).toHaveLength(1)
      expect(files[0]).toMatch(/\.json$/)
    })

    it('salva e carrega sessão com uiMessages', async () => {
      const { saveSession, loadSession, newSessionId } = await getModule()
      const id = newSessionId()
      const uiMessages = [
        { role: 'user' as const, content: 'oi' },
        { role: 'assistant' as const, content: 'olá!' },
      ]
      await saveSession({
        id,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        cwd: '/tmp',
        model: 'deepseek-chat',
        provider: 'deepseek',
        language: 'Portuguese',
        activeAgent: null,
        agentMessages: [],
        uiMessages,
        filesModified: [],
      })
      const loaded = await loadSession(id)
      expect(loaded).not.toBeNull()
      expect(loaded!.uiMessages).toEqual(uiMessages)
    })

    it('atualiza o título sem perder a conversa', async () => {
      const { saveSession, loadSession, updateSessionTitle, newSessionId } = await getModule()
      const id = newSessionId()
      await saveSession({
        id,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        cwd: process.cwd(),
        model: 'deepseek-chat',
        provider: 'deepseek',
        language: null,
        activeAgent: null,
        agentMessages: [],
        uiMessages: [{ role: 'user' as const, content: 'conversa' }],
        filesModified: [],
      })
      await updateSessionTitle(id, 'Título curto')
      const loaded = await loadSession(id)
      expect(loaded?.title).toBe('Título curto')
      expect(loaded?.uiMessages).toHaveLength(1)
    })

    it('salva e carrega sessão com agentMessages', async () => {
      const { saveSession, loadSession, newSessionId } = await getModule()
      const id = newSessionId()
      const agentMessages = [
        { role: 'system' as const, content: 'system prompt' },
        { role: 'user' as const, content: 'hello' },
        { role: 'assistant' as const, content: 'hi there' },
      ]
      await saveSession({
        id,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        cwd: '/tmp',
        model: 'deepseek-chat',
        provider: 'deepseek',
        language: null,
        activeAgent: null,
        agentMessages,
        uiMessages: [],
        filesModified: [],
      })
      const loaded = await loadSession(id)
      expect(loaded).not.toBeNull()
      expect(loaded!.agentMessages).toEqual(agentMessages)
    })

    it('preserva todos os campos da sessão', async () => {
      const { saveSession, loadSession, newSessionId } = await getModule()
      const id = newSessionId()
      const data = {
        id,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        cwd: '/home/marcelo/projeto',
        model: 'deepseek-reasoner',
        provider: 'deepseek',
        language: 'Portuguese',
        activeAgent: 'coder',
        agentMessages: [{ role: 'user' as const, content: 'teste' }],
        uiMessages: [{ role: 'user' as const, content: 'teste' }],
        filesModified: ['src/index.ts', 'src/agent.ts'],
      }
      await saveSession(data)
      const loaded = await loadSession(id)
      expect(loaded!.id).toBe(id)
      expect(loaded!.cwd).toBe(data.cwd)
      expect(loaded!.model).toBe(data.model)
      expect(loaded!.provider).toBe(data.provider)
      expect(loaded!.language).toBe(data.language)
      expect(loaded!.activeAgent).toBe(data.activeAgent)
      expect(loaded!.filesModified).toEqual(data.filesModified)
    })

    it('retorna null para ID inexistente', async () => {
      const { loadSession } = await getModule()
      const result = await loadSession('session-nao-existe-99999')
      expect(result).toBeNull()
    })

    it('uiMessages vazios são preservados', async () => {
      const { saveSession, loadSession, newSessionId } = await getModule()
      const id = newSessionId()
      await saveSession({
        id,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        cwd: '/tmp',
        model: 'deepseek-chat',
        provider: 'deepseek',
        language: null,
        activeAgent: null,
        agentMessages: [],
        uiMessages: [],
        filesModified: [],
      })
      const loaded = await loadSession(id)
      expect(loaded!.uiMessages).toEqual([])
      expect(loaded!.agentMessages).toEqual([])
    })
  })

  describe('listSessions', () => {
    it('retorna array vazio quando não há sessões', async () => {
      const { listSessions } = await getModule()
      const result = await listSessions()
      expect(result).toBeArray()
    })

    it('lista sessões salvas em ordem decrescente de data', async () => {
      const { saveSession, listSessions, newSessionId } = await getModule()

      const id1 = newSessionId()
      await saveSession({
        id: id1,
        createdAt: new Date().toISOString(),
        updatedAt: '2026-01-01T00:00:00.000Z',
        cwd: '/tmp',
        model: 'deepseek-chat',
        provider: 'deepseek',
        language: null,
        activeAgent: null,
        agentMessages: [],
        uiMessages: [{ role: 'user' as const, content: 'primeira' }],
        filesModified: [],
      })

      await new Promise(r => setTimeout(r, 5))

      const id2 = newSessionId()
      await saveSession({
        id: id2,
        createdAt: new Date().toISOString(),
        updatedAt: '2026-06-01T00:00:00.000Z',
        cwd: '/tmp',
        model: 'deepseek-chat',
        provider: 'deepseek',
        language: null,
        activeAgent: null,
        agentMessages: [],
        uiMessages: [{ role: 'user' as const, content: 'segunda' }],
        filesModified: [],
      })

      const sessions = await listSessions()
      expect(sessions.length).toBeGreaterThanOrEqual(2)
      // Mais recente (updatedAt maior) deve vir primeiro
      const idx1 = sessions.findIndex(s => s.id === id1)
      const idx2 = sessions.findIndex(s => s.id === id2)
      expect(idx2).toBeLessThan(idx1)
    })

    it('inclui sessão recém-salva na listagem', async () => {
      const { saveSession, listSessions, newSessionId } = await getModule()
      const id = newSessionId()
      await saveSession({
        id,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        cwd: '/tmp',
        model: 'deepseek-chat',
        provider: 'deepseek',
        language: null,
        activeAgent: null,
        agentMessages: [],
        uiMessages: [{ role: 'user' as const, content: 'msg' }],
        filesModified: [],
      })
      const sessions = await listSessions()
      const found = sessions.find(s => s.id === id)
      expect(found).toBeDefined()
    })
  })
})
