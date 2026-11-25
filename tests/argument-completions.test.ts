import { afterEach, describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { saveSession } from '../src/agent/session.js'
import { getArgumentMatches } from '../src/ui/input/argumentMatches.js'

const originalHome = process.env.HOME
const roots: string[] = []

afterEach(async () => {
  process.env.HOME = originalHome
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('slash argument completions', () => {
  it('offers local enum and subcommand values only for exact built-in commands', async () => {
    expect(await getArgumentMatches('/catalog m', 10, process.cwd())).toMatchObject({ values: ['mcp'], replaceStart: 9, replaceEnd: 10 })
    expect(await getArgumentMatches('/effort ', 8, process.cwd())).toMatchObject({ values: ['low', 'high', 'max', 'auto', 'status'] })
    expect(await getArgumentMatches('/custom m', 9, process.cwd())).toBeNull()
    expect(await getArgumentMatches('/catalog m', 9, process.cwd())).toBeNull()
  })

  it('suggests session IDs from the current workspace only', async () => {
    const home = await mkdtemp(join(tmpdir(), 'deepseek-argument-completions-'))
    roots.push(home)
    process.env.HOME = home
    const project = join(home, 'project')
    const otherProject = join(home, 'other-project')
    await Promise.all([mkdir(project), mkdir(otherProject)])

    const session = (id: string, cwd: string) => ({
      id, cwd, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      model: 'local', provider: 'local', language: null, activeAgent: null,
      agentMessages: [], uiMessages: [], filesModified: [],
    })
    await saveSession(session('a1b2c3d4e5f6', project) as never)
    await saveSession(session('invalid-id', project) as never)
    await saveSession(session('0f1e2d3c4b5a', otherProject) as never)

    const matches = await getArgumentMatches('/sessions export ', 17, project)
    expect(matches?.values).toEqual(['a1b2c3d4e5f6'])
  })

  it('suggests local worktree IDs without returning hidden names or paths', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-worktree-completions-'))
    roots.push(root)
    const worktrees = join(root, '.deepseek', 'worktrees')
    await mkdir(worktrees, { recursive: true })
    await Promise.all([
      mkdir(join(worktrees, 'safe-id')),
      mkdir(join(worktrees, '.hidden')),
      mkdir(join(worktrees, 'unparseable name')),
    ])

    const matches = await getArgumentMatches('/worktree enter ', 16, root)
    expect(matches?.values).toEqual(['safe-id'])
  })
})
