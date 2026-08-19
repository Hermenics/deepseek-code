import { describe, it, expect, beforeEach } from 'bun:test'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import {
  hasBinary,
  clearBinaryCache,
  scrubbedEnv,
  userStateDir,
  defaultShell,
  sandboxAvailable,
  isWindows,
} from '../src/utils/platform.js'
import { jsGrep } from '../src/tools/Grep/jsGrep.js'
import { clearIgnoreCache } from '../src/tools/shared/deepseekignore.js'

beforeEach(() => {
  clearBinaryCache()
  clearIgnoreCache()
})

describe('hasBinary', () => {
  it('finds a binary that certainly exists on this platform', () => {
    expect(hasBinary(isWindows ? 'cmd.exe' : 'sh')).toBe(true)
  })

  it('reports a missing binary as absent', () => {
    expect(hasBinary('definitely-not-a-real-binary-xyz')).toBe(false)
  })

  it('caches the probe result', () => {
    expect(hasBinary('definitely-not-a-real-binary-xyz')).toBe(false)
    expect(hasBinary('definitely-not-a-real-binary-xyz')).toBe(false)
  })
})

describe('scrubbedEnv', () => {
  it('keeps PATH so commands can still be resolved', () => {
    expect(scrubbedEnv().PATH).toBeTruthy()
  })

  it('drops secrets that are not on the allow-list', () => {
    process.env.DEEPSEEK_API_KEY = 'sk-should-not-leak'
    process.env.AWS_SECRET_ACCESS_KEY = 'should-not-leak'
    const env = scrubbedEnv()
    expect(env.DEEPSEEK_API_KEY).toBeUndefined()
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined()
    delete process.env.DEEPSEEK_API_KEY
    delete process.env.AWS_SECRET_ACCESS_KEY
  })
})

describe('platform helpers', () => {
  it('returns an absolute, platform-appropriate state dir', () => {
    const dir = userStateDir('deepseek-code')
    expect(path.isAbsolute(dir)).toBe(true)
    expect(dir).toContain('deepseek-code')
  })

  it('returns a shell path', () => {
    expect(defaultShell().length).toBeGreaterThan(0)
  })

  it('only reports a sandbox on Linux', () => {
    if (process.platform !== 'linux') expect(sandboxAvailable()).toBe(false)
    else expect(typeof sandboxAvailable()).toBe('boolean')
  })
})

describe('jsGrep', () => {
  let root: string
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsk-jsgrep-'))
    clearIgnoreCache()
    fs.mkdirSync(path.join(root, 'src'), { recursive: true })
    fs.writeFileSync(path.join(root, 'src', 'a.ts'), 'const needle = 1\nconst other = 2\n')
    fs.writeFileSync(path.join(root, 'src', 'b.ts'), 'no match here\n')
    fs.mkdirSync(path.join(root, 'node_modules', 'pkg'), { recursive: true })
    fs.writeFileSync(path.join(root, 'node_modules', 'pkg', 'c.ts'), 'const needle = 3\n')
  })

  const run = (pattern: string, include?: string) =>
    jsGrep({ dir: root, pattern, include, workspaceRoot: root, ignoreDirs: ['node_modules'], limit: 100 })

  it('finds matches and reports file:line:text', async () => {
    const { lines } = await run('needle')
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('a.ts:1:')
    expect(lines[0]).toContain('const needle = 1')
  })

  it('respects .deepseekignore defaults', async () => {
    const { lines } = await run('needle')
    expect(lines.join('\n')).not.toContain('node_modules')
  })

  it('honours the include filter', async () => {
    const { lines } = await run('needle', '*.md')
    expect(lines).toHaveLength(0)
  })

  it('returns no matches instead of throwing', async () => {
    const { lines, error } = await run('zzz-nothing-here')
    expect(error).toBeUndefined()
    expect(lines).toHaveLength(0)
  })

  it('reports an invalid regex as an error', async () => {
    const { error } = await run('([unclosed')
    expect(error).toContain('Invalid pattern')
  })

  it('skips binary files', async () => {
    fs.writeFileSync(path.join(root, 'src', 'bin.dat'), Buffer.from([0x6e, 0x00, 0x65, 0x65]))
    const { lines } = await run('n')
    expect(lines.join('\n')).not.toContain('bin.dat')
  })

  it('uses BRE operators like native grep', async () => {
    const { lines } = await run('needle\\|other')
    expect(lines).toHaveLength(2)
  })

  it('keeps only limit plus one matches while counting every match', async () => {
    fs.writeFileSync(path.join(root, 'src', 'many.ts'), Array.from({ length: 5 }, (_, i) => `needle ${i}`).join('\n'))
    const result = await jsGrep({ dir: root, pattern: 'needle', workspaceRoot: root, ignoreDirs: ['node_modules'], limit: 2 })
    expect(result.lines).toHaveLength(3)
    expect(result.totalMatches).toBe(6)
  })

  it('returns before discovery when already cancelled', async () => {
    const controller = new AbortController()
    controller.abort()
    const cancelled = await jsGrep({ dir: root, pattern: 'needle', workspaceRoot: root, ignoreDirs: ['node_modules'], limit: 100, signal: controller.signal })
    expect(cancelled).toEqual({ lines: [] })
  })
})
