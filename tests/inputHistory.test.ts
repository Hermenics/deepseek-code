import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

let testDir: string

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), 'dsk-history-test-'))
  process.env.HOME = testDir
})

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true })
})

describe('loadInputHistory', () => {
  it('retorna [] se arquivo não existe', async () => {
    const { loadInputHistory } = await import('../src/agent/inputHistory.js')
    expect(await loadInputHistory()).toEqual([])
  })

  it('retorna entradas salvas', async () => {
    const fs = await import('fs/promises')
    const historyPath = join(testDir, '.deepseek', 'input_history.json')
    await fs.mkdir(join(testDir, '.deepseek'), { recursive: true })
    await fs.writeFile(historyPath, JSON.stringify(['entrada1', 'entrada2']), 'utf-8')
    const { loadInputHistory } = await import('../src/agent/inputHistory.js')
    expect(await loadInputHistory()).toEqual(['entrada1', 'entrada2'])
  })
})

describe('appendInputHistory', () => {
  it('persiste nova entrada', async () => {
    const { appendInputHistory, loadInputHistory } = await import('../src/agent/inputHistory.js')
    await appendInputHistory('nova entrada')
    const history = await loadInputHistory()
    expect(history).toContain('nova entrada')
  })

  it('não duplica entrada consecutiva igual', async () => {
    const fs = await import('fs/promises')
    const historyPath = join(testDir, '.deepseek', 'input_history.json')
    await fs.mkdir(join(testDir, '.deepseek'), { recursive: true })
    await fs.writeFile(historyPath, JSON.stringify(['entrada repetida']), 'utf-8')
    const { appendInputHistory, loadInputHistory } = await import('../src/agent/inputHistory.js')
    await appendInputHistory('entrada repetida')
    const history = await loadInputHistory()
    expect(history.filter(e => e === 'entrada repetida').length).toBe(1)
  })

  it('respeita limite de 200 entradas', async () => {
    const fs = await import('fs/promises')
    const historyPath = join(testDir, '.deepseek', 'input_history.json')
    const entries = Array.from({ length: 250 }, (_, i) => `entrada-${i}`)
    await fs.mkdir(join(testDir, '.deepseek'), { recursive: true })
    await fs.writeFile(historyPath, JSON.stringify(entries), 'utf-8')
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

  it('aprende estatísticas simples do estilo do usuário', async () => {
    const { appendInputHistory, loadWritingStyle, describeWritingStyle } = await import('../src/agent/inputHistory.js')
    await appendInputHistory('sim, faca isso.')
    const style = await loadWritingStyle()
    expect(style.samples).toBe(1)
    expect(style.lowercase).toBe(1)
    expect(style.noAccents).toBe(1)
    expect(style.comma).toBe(1)
    expect(style.period).toBe(1)
    expect(describeWritingStyle(style)).toContain('minúsculas')
  })
})
