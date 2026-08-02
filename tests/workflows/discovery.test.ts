import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { discoverWorkflows } from '../../src/workflows/discovery.js'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))))

describe('workflow discovery', () => {
  test('prefers the nearest project workflow over global', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-workflows-'))
    roots.push(root)
    const project = join(root, 'project')
    const nested = join(project, 'packages', 'app')
    const nearest = join(nested, '.deepseek', 'workflows')
    const global = join(root, 'global')
    await mkdir(join(project, '.git'), { recursive: true })
    await mkdir(nearest, { recursive: true })
    await mkdir(global, { recursive: true })
    await writeFile(join(nearest, 'review.js'), 'export const meta = {"name":"review"}; return "local";')
    await writeFile(join(global, 'review.js'), 'export const meta = {"name":"review"}; return "global";')

    const workflows = await discoverWorkflows(nested, { globalDirectory: global })
    expect(workflows).toHaveLength(1)
    expect(workflows[0]?.source).toBe('project')
    expect(workflows[0]?.path).toBe(join(nearest, 'review.js'))
  })

  test('rejects symlinks that escape the workflow directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-workflows-'))
    roots.push(root)
    const project = join(root, 'project')
    const directory = join(project, '.deepseek', 'workflows')
    await mkdir(join(project, '.git'), { recursive: true })
    await mkdir(directory, { recursive: true })
    const outside = join(root, 'outside.js')
    await writeFile(outside, 'export const meta = {"name":"escaped"}; return 1;')
    await symlink(outside, join(directory, 'escaped.js'))

    expect(await discoverWorkflows(project, { globalDirectory: join(root, 'missing') })).toEqual([])
  })
})
