import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { parseCommand } from '../../src/commands/index.js'
import { getMatches } from '../../src/ui/input/commandMatches.js'
import { refreshWorkflowCommands, resolveWorkflowCommand } from '../../src/workflows/commands.js'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))))

describe('workflow commands', () => {
  test('parses run and lifecycle controls', () => {
    expect(parseCommand('/workflows')).toEqual({ type: 'workflows' })
    expect(parseCommand('/workflow run audit {"target":"src"}')).toEqual({ type: 'workflow', action: 'run', name: 'audit', args: '{"target":"src"}' })
    expect(parseCommand('/workflow pause abc')).toEqual({ type: 'workflow', action: 'pause', id: 'abc' })
    expect(parseCommand('/workflow resume abc')).toEqual({ type: 'workflow', action: 'resume', id: 'abc' })
    expect(parseCommand('/workflow stop abc')).toEqual({ type: 'workflow', action: 'stop', id: 'abc' })
    expect(parseCommand('/workflow restart abc')).toEqual({ type: 'workflow', action: 'restart', id: 'abc' })
    expect(parseCommand('/workflow save abc audit')).toEqual({ type: 'workflow', action: 'save', id: 'abc', name: 'audit' })
  })

  test('discovers saved workflows as direct slash commands and autocomplete entries', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-workflow-command-'))
    roots.push(root)
    await mkdir(join(root, '.git'), { recursive: true })
    await mkdir(join(root, '.deepseek', 'workflows'), { recursive: true })
    await writeFile(join(root, '.deepseek', 'workflows', 'audit.js'), 'export const meta = {"name":"audit","description":"Audit it"}; return args;')

    await refreshWorkflowCommands(root)
    expect(await resolveWorkflowCommand('/audit {"x":1}', root)).toEqual({ type: 'workflow', action: 'run', name: 'audit', args: '{"x":1}' })
    expect(getMatches('/aud')).toContain('/audit')
  })
})
