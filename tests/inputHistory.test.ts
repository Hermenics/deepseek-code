import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import * as path from 'path'
import * as os from 'os'
import * as fs from 'fs/promises'

const HISTORY_PATH = path.join(os.homedir(), '.deepseek', 'input_history.json')

async function backupAndClear() {
  let backup: string | null = null
  try { backup = await fs.readFile(HISTORY_PATH, 'utf-8') } catch { /* não existe */ }
  await fs.rm(HISTORY_PATH, { force: true })
  return backup
}

async function restore(backup: string | null) {
  await fs.rm(HISTORY_PATH, { force: true })
  if (backup !== null) {
    await fs.mkdir(path.dirname(HISTORY_PATH), { recursive: true })
    await fs.writeFile(HISTORY_PATH, backup, 'utf-8')
  }
}

describe('loadInputHistory', () => {
  let backup: string | null = null

  beforeEach(async () => { backup = await backupAndClear() })
  afterEach(async () => { await restore(backup) })

  it('retorna [] se arquivo não existe', async () => {
    const { loadInputHistory } = await import('../src/agent/inputHistory.js')
    expect(await loadInputHistory()).toEqual([])
  })

  it('retorna entradas salvas', async () => {
    await fs.mkdir(path.dirname(HISTORY_PATH), { recursive: true })
    await fs.writeFile(HISTORY_PATH, JSON.stringify(['entrada1', 'entrada2']), 'utf-8')
    const { loadInputHistory } = await import('../src/agent/inputHistory.js')
    expect(await loadInputHistory()).toEqual(['entrada1', 'entrada2'])
  })
})

describe('appendInputHistory', () => {
  let backup: string | null = null

  beforeEach(async () => { backup = await backupAndClear() })
  afterEach(async () => { await restore(backup) })

  it('persiste nova entrada', async () => {
    const { appendInputHistory, loadInputHistory } = await import('../src/agent/inputHistory.js')
    await appendInputHistory('nova entrada')
    const history = await loadInputHistory()
    expect(history).toContain('nova entrada')
  })

  it('não duplica entrada consecutiva igual', async () => {
    await fs.mkdir(path.dirname(HISTORY_PATH), { recursive: true })
    await fs.writeFile(HISTORY_PATH, JSON.stringify(['entrada repetida']), 'utf-8')
    const { appendInputHistory, loadInputHistory } = await import('../src/agent/inputHistory.js')
    await appendInputHistory('entrada repetida')
    const history = await loadInputHistory()
    expect(history.filter(e => e === 'entrada repetida').length).toBe(1)
  })

  it('respeita limite de 200 entradas', async () => {
    const entries = Array.from({ length: 250 }, (_, i) => `entrada-${i}`)
    await fs.mkdir(path.dirname(HISTORY_PATH), { recursive: true })
    await fs.writeFile(HISTORY_PATH, JSON.stringify(entries), 'utf-8')
    const { appendInputHistory, loadInputHistory } = await import('../src/agent/inputHistory.js')
    await appendInputHistory('nova')
    const history = await loadInputHistory()
    expect(history.length).toBeLessThanOrEqual(200)
  })

  it('não salva comandos que começam com /', async () => {
    const { appendInputHistory, loadInputHistory } = await import('../src/agent/inputHistory.js')
    await appendInputHistory('/help')
    await appendInputHistory('/clear')
    await appendInputHistory('/stats')
    const history = await loadInputHistory()
    expect(history.filter(e => e.startsWith('/'))).toHaveLength(0)
  })

  it('não salva comandos shell que começam com !', async () => {
    const { appendInputHistory, loadInputHistory } = await import('../src/agent/inputHistory.js')
    await appendInputHistory('!ls -la')
    await appendInputHistory('! git status')
    const history = await loadInputHistory()
    expect(history.filter(e => e.trimStart().startsWith('!'))).toHaveLength(0)
  })

  it('salva mensagens normais que não são comandos', async () => {
    const { appendInputHistory, loadInputHistory } = await import('../src/agent/inputHistory.js')
    await appendInputHistory('explica esse código')
    const history = await loadInputHistory()
    expect(history).toContain('explica esse código')
  })
})
