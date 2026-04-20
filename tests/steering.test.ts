import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import * as path from 'path'
import * as fs from 'fs/promises'

// loadSteering lê de .deepseek/steering no cwd — criamos arquivos reais e limpamos
const STEERING_DIR = path.join(process.cwd(), '.deepseek', 'steering')

async function cleanSteeringDir() {
  await fs.rm(STEERING_DIR, { recursive: true, force: true })
}

describe('loadSteering', () => {
  beforeEach(async () => {
    await cleanSteeringDir()
  })

  afterEach(async () => {
    await cleanSteeringDir()
  })

  it('retorna string vazia se diretório não existe', async () => {
    const { loadSteering } = await import('../src/agent/steering.js')
    const result = await loadSteering()
    expect(result).toBe('')
  })

  it('lê e formata arquivo .md com separador', async () => {
    await fs.mkdir(STEERING_DIR, { recursive: true })
    await fs.writeFile(path.join(STEERING_DIR, 'rules.md'), 'conteúdo do arquivo', 'utf-8')
    const { loadSteering } = await import('../src/agent/steering.js')
    const result = await loadSteering()
    expect(result).toContain('--- rules.md ---')
    expect(result).toContain('conteúdo do arquivo')
  })

  it('múltiplos arquivos são separados por \\n\\n', async () => {
    await fs.mkdir(STEERING_DIR, { recursive: true })
    await fs.writeFile(path.join(STEERING_DIR, 'a.md'), 'conteúdo a', 'utf-8')
    await fs.writeFile(path.join(STEERING_DIR, 'b.md'), 'conteúdo b', 'utf-8')
    const { loadSteering } = await import('../src/agent/steering.js')
    const result = await loadSteering()
    expect(result).toContain('\n\n')
    expect(result).toContain('--- a.md ---')
    expect(result).toContain('--- b.md ---')
  })

  it('ignora arquivos que não são .md', async () => {
    await fs.mkdir(STEERING_DIR, { recursive: true })
    await fs.writeFile(path.join(STEERING_DIR, 'rules.md'), 'conteúdo md', 'utf-8')
    await fs.writeFile(path.join(STEERING_DIR, 'ignore.txt'), 'conteúdo txt', 'utf-8')
    const { loadSteering } = await import('../src/agent/steering.js')
    const result = await loadSteering()
    expect(result).toContain('rules.md')
    expect(result).not.toContain('ignore.txt')
  })
})
