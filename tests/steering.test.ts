import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import * as path from 'path'
import * as fs from 'fs/promises'

// loadSteering reads from .deepseek/steering in cwd; create real files and clean up.
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

  it('returns an empty string when the directory does not exist', async () => {
    const { loadSteering } = await import('../src/agent/steering.js')
    const result = await loadSteering()
    expect(result).toBe('')
  })

  it('reads and formats a .md file with a separator', async () => {
    await fs.mkdir(STEERING_DIR, { recursive: true })
    await fs.writeFile(path.join(STEERING_DIR, 'rules.md'), 'file content', 'utf-8')
    const { loadSteering } = await import('../src/agent/steering.js')
    const result = await loadSteering()
    expect(result).toContain('--- rules.md ---')
    expect(result).toContain('file content')
  })

  it('separates multiple files with \\n\\n', async () => {
    await fs.mkdir(STEERING_DIR, { recursive: true })
    await fs.writeFile(path.join(STEERING_DIR, 'a.md'), 'content a', 'utf-8')
    await fs.writeFile(path.join(STEERING_DIR, 'b.md'), 'content b', 'utf-8')
    const { loadSteering } = await import('../src/agent/steering.js')
    const result = await loadSteering()
    expect(result).toContain('\n\n')
    expect(result).toContain('--- a.md ---')
    expect(result).toContain('--- b.md ---')
  })

  it('ignores files that are not .md', async () => {
    await fs.mkdir(STEERING_DIR, { recursive: true })
    await fs.writeFile(path.join(STEERING_DIR, 'rules.md'), 'Markdown content', 'utf-8')
    await fs.writeFile(path.join(STEERING_DIR, 'ignore.txt'), 'text content', 'utf-8')
    const { loadSteering } = await import('../src/agent/steering.js')
    const result = await loadSteering()
    expect(result).toContain('rules.md')
    expect(result).not.toContain('ignore.txt')
  })
})
