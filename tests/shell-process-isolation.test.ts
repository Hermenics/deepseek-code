import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Shell } from '../src/tools/Shell/Shell.js'
import { sandboxAvailable } from '../src/utils/platform.js'

const itWithSandbox = it.skipIf(!sandboxAvailable())
const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('Shell process isolation', () => {
  itWithSandbox('starts consecutive calls in the workspace without carrying shell state', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-shell-process-isolation-'))
    roots.push(root)
    await writeFile(join(root, '.shell-process-isolation-marker'), 'workspace')

    const context = {
      sessionId: 'shell-process-isolation-test',
      workspacePath: root,
      projectRoot: root,
      permissionProfile: 'coordinator-integrator' as const,
    }

    const first = await Shell.execute({
      command: 'cd /tmp && export DEEPSEEK_C30_STATE=first-call && pwd && printf "|%s" "$DEEPSEEK_C30_STATE"',
    }, context)
    expect(first).toContain('/tmp\n|first-call')

    const second = await Shell.execute({
      command: 'pwd && test -f .shell-process-isolation-marker && printf "|workspace" && printf "|%s" "${DEEPSEEK_C30_STATE:-missing}"',
    }, context)
    expect(second).toContain(`/mnt\n|workspace|missing`)
  })
})
