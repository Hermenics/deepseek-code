import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Shell } from '../src/tools/Shell/Shell.js'
import { sandboxAvailable } from '../src/utils/platform.js'

const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

function context(root: string, permissionProfile: 'coordinator-integrator' | 'researcher-readonly') {
  return { sessionId: 'h01-test', workspacePath: root, projectRoot: root, permissionProfile } as const
}

describe('shell security boundary', () => {
  it('scrubs inherited canary variables for coordinators and workers', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-h01-shell-'))
    roots.push(root)
    const key = 'DEEPSEEK_H01_CANARY'
    const token = 'h01-canary-must-not-escape'
    const previous = process.env[key]
    process.env[key] = token
    try {
      for (const permissionProfile of ['coordinator-integrator', 'researcher-readonly'] as const) {
        const result = await Shell.execute({ command: `printf '%s' "\${${key}:-missing}"` }, context(root, permissionProfile))
        if (sandboxAvailable()) expect(result).toContain('missing')
        else expect(result).toContain('contextual shell execution is blocked')
        expect(result).not.toContain(token)
      }
    } finally {
      if (previous === undefined) delete process.env[key]
      else process.env[key] = previous
    }
  })

  it('blocks network capability without explicit approval', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-h01-network-'))
    roots.push(root)
    const result = await Shell.execute(
      { command: 'curl https://example.invalid' },
      context(root, 'coordinator-integrator'),
    )
    expect(result).toContain('network access requires explicit approval')
  })

  it('still permits ordinary isolated shell commands', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-h01-command-'))
    roots.push(root)
    const result = await Shell.execute(
      { command: 'printf allowed' },
      context(root, 'coordinator-integrator'),
    )
    if (sandboxAvailable()) expect(result).toContain('allowed')
    else expect(result).toContain('contextual shell execution is blocked')
  })
})
