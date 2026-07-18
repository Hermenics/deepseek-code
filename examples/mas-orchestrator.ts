import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execa } from 'execa'
import { OrchestratorSession } from '../src/orchestration/index.js'

async function main(): Promise<void> {
  const projectRoot = await mkdtemp(join(tmpdir(), 'deepseek-mas-example-'))
  let shutdownSession: OrchestratorSession | undefined
  try {
    await execa('git', ['init', '-q'], { cwd: projectRoot })
    await execa('git', ['config', 'user.email', 'example@deepseek.local'], { cwd: projectRoot })
    await execa('git', ['config', 'user.name', 'DeepSeek MAS Example'], { cwd: projectRoot })
    await writeFile(join(projectRoot, 'value.ts'), 'export const value = 1\n')
    await writeFile(join(projectRoot, '.gitignore'), '.deepseek/\nmas-events.jsonl\n')
    await execa('git', ['add', '--', 'value.ts', '.gitignore'], { cwd: projectRoot })
    await execa('git', ['commit', '-qm', 'example base'], { cwd: projectRoot })

    const session = new OrchestratorSession({ projectRoot, logFile: join(projectRoot, 'mas-events.jsonl') })
    shutdownSession = session
    const coordinator = session.spawn({ taskId: 'coordinator', allowDelegation: true }, async () => ({ plan: 'research, write, test, verify' }))
    await coordinator.awaitResult()

    const researchers = ['correctness', 'security'].map(name => session.spawn({
      taskId: `research-${name}`, parentTaskId: coordinator.taskId,
      permissionProfile: 'researcher-readonly', allowDelegation: false,
    }, async () => ({ name, source: await readFile(join(projectRoot, 'value.ts'), 'utf8') })))
    await Promise.all(researchers.map(handle => handle.awaitResult()))

    const writer = session.spawn({
      taskId: 'writer', parentTaskId: coordinator.taskId,
      dependencies: researchers.map(handle => handle.taskId), permissionProfile: 'writer-worktree', allowDelegation: false,
    }, async context => {
      const lease = await session.acquireWorkspace(context.taskId, 'writer-worktree', context.signal)
      try {
        await writeFile(join(lease.workspace.path, 'value.ts'), 'export const value = 2\n')
        return { changed: ['value.ts'], workspace: lease.workspace.path }
      } finally { await lease.release() }
    })
    await writer.awaitResult()
    const integration = await session.integrateTask(writer.taskId)
    if (!integration.integrated) throw new Error(integration.conflict)

    const tester = session.spawn({ taskId: 'tester', parentTaskId: coordinator.taskId, dependencies: [writer.taskId], permissionProfile: 'tester' },
      async () => ({ passed: (await readFile(join(projectRoot, 'value.ts'), 'utf8')).includes('value = 2') }))
    const testResult = await tester.awaitResult()
    const testsPassed = (testResult.value as { passed?: boolean } | undefined)?.passed === true
    const verifier = session.spawn({ taskId: 'verifier', parentTaskId: coordinator.taskId, dependencies: [tester.taskId], permissionProfile: 'researcher-readonly' },
      async () => testResult.status === 'done' && testsPassed
        ? { classification: 'CONFIRMED', evidence: ['tester reported passed=true'] }
        : { classification: testResult.status === 'done' ? 'REFUTED' : 'PLAUSIBLE', evidence: [`tester status=${testResult.status}`] })
    const result = await verifier.awaitResult()
    await session.cleanupTaskWorkspace(writer.taskId)
    await session.flush()
    process.stdout.write(`${JSON.stringify({ tasks: session.registry.listTasks(), verification: result.value }, null, 2)}\n`)
  } finally {
    await shutdownSession?.shutdown()
    await rm(projectRoot, { recursive: true, force: true })
  }
}

await main()
