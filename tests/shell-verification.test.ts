import { expect, it } from 'bun:test'
import { chmod, mkdtemp, mkdir, readFile, writeFile, rm, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Shell } from '../src/tools/Shell/Shell.js'
import type { Tool } from '../src/tools/types.js'
import { detectVerificationCommand, runVerification, type VerificationResult } from '../src/agent/verify.js'
import { sandboxAvailable, scrubbedEnv } from '../src/utils/platform.js'
import { captureWorkspaceVersion } from '../src/agent/workspaceVersion.js'
import { OrchestratorSession } from '../src/orchestration/OrchestratorSession.js'
import { AGGREGATE_TURN_BYTES } from '../src/orchestration/aggregateBudget.js'

const sandboxTest = it.skipIf(!sandboxAvailable())
async function fixture(run: (root: string, context: any, receipts: VerificationResult[]) => Promise<void>, test?: string) {
  const root = await mkdtemp(join(tmpdir(), 'deepseek-shell-verification-'))
  const receipts: VerificationResult[] = []
  const context = { sessionId: 'verification-fixture', workspacePath: root, projectRoot: root, permissionProfile: 'coordinator-integrator' as const,
    recordVerification: (result: VerificationResult) => { receipts.push(result); return 'recorded-receipt' },
  }
  try {
    await writeFile(join(root, 'package.json'), JSON.stringify({ scripts: { test: 'bun test' } }))
    await writeFile(join(root, 'bun.lock'), '')
    if (test) await writeFile(join(root, 'contract.test.ts'), test)
    await run(root, context, receipts)
  } finally { await rm(root, { recursive: true, force: true }) }
}

it('counts generic verification output bytes before stripping ANSI and trimming', async () => {
  await fixture(async root => {
    const raw = '\u001b[31mé\u001b[0m \n'
    const result = await runVerification({ command: process.execPath, args: ['test'], display: 'bun test' }, root, {
      execute: async () => ({ all: raw, exitCode: 0 }),
    })

    expect(result.output).toStartWith('é\n')
    expect(result.outputBytes).toBe(Buffer.byteLength(raw, 'utf8'))
    expect(result.outputBytes).not.toBe(Buffer.byteLength(result.output, 'utf8'))
  })
})

it('preserves the exact output byte count supplied by a captured verification runner', async () => {
  await fixture(async root => {
    const result = await runVerification({ command: process.execPath, args: ['test'], display: 'bun test' }, root, {
      execute: async () => ({ all: 'short preview', outputBytes: 97, exitCode: 0 }),
    })

    expect(result.outputBytes).toBe(97)
  })
})

sandboxTest('charges exact verification capture bytes and preserves the receipt when the aggregate quota is exhausted', async () => {
  await fixture(async (root, context, receipts) => {
    const session = new OrchestratorSession({ sessionId: context.sessionId, projectRoot: root, logFile: null, snapshotFile: null })
    const budgetGroupId = 'verification-output-shared-group'
    try {
      expect(session.registry.recordAggregateOutputBytes(budgetGroupId, AGGREGATE_TURN_BYTES - 1)).toBe(true)
      const toolContext = {
        ...session.toolContext({ workspacePath: root, budgetGroupId }),
        recordVerification: context.recordVerification,
      }
      const result = JSON.parse(await Shell.execute({ command: 'bun run test', verification: true }, toolContext))
      const receipt = receipts.at(-1)!

      expect(result.status).toBe('partial')
      expect(result.error.code).toBe('AGGREGATE_OUTPUT_BYTES_EXCEEDED')
      expect(receipt.outputBytes).toBeGreaterThan(1)
      expect(result.partial.outputBytes).toBe(receipt.outputBytes)
      expect(result.partial.evidenceId).toBe('recorded-receipt')
      expect(result.partial.verification.outputBytes).toBe(receipt.outputBytes)
      expect(result.partial.verification.evidenceId).toBe('recorded-receipt')
      expect(session.registry.recordAggregateOutputBytes(budgetGroupId, 1)).toBe(false)
    } finally {
      await session.shutdown()
    }
  }, "import { it, expect } from 'bun:test'; it('quota receipt', () => expect(1).toBe(1))")
})

sandboxTest('records a real sandboxed test receipt without a UI or inherited provider credentials', async () => {
  await fixture(async (root, context, receipts) => {
    const before = process.env.DEEPSEEK_API_KEY
    process.env.DEEPSEEK_API_KEY = 'shell-verification-canary'
    try {
      const output = JSON.parse(await Shell.execute({ command: 'bun run test', verification: true }, context))
      expect(output.status).toBe('passed')
      expect(output.exitCode).toBe(0)
      expect(output.testCount).toBe(1)
      expect(output.evidenceId).toBe('recorded-receipt')
      expect(receipts).toHaveLength(1)
      expect(receipts[0]?.inputDigest).toBe((await captureWorkspaceVersion(root)).digest)
      expect(receipts[0]?.finalDigest).toBe(receipts[0]?.inputDigest)
      expect(receipts[0]?.executionEnvironment).toBe('linux-bwrap')
      expect(receipts[0]?.allowNetwork).toBe(false)
      expect(receipts[0]?.executionFingerprint).toMatch(/^[a-f0-9]{64}$/)
      expect(receipts[0]?.finalExecutionFingerprint).toBe(receipts[0]?.executionFingerprint)
      expect(output.output).not.toContain('shell-verification-canary')
    } finally {
      if (before === undefined) delete process.env.DEEPSEEK_API_KEY
      else process.env.DEEPSEEK_API_KEY = before
    }
  }, "import { it, expect } from 'bun:test'; it('provider keys absent', () => expect(process.env.DEEPSEEK_API_KEY).toBeUndefined())")
})

it('refuses arbitrary commands and background verification without running their effects', async () => {
  await fixture(async (root, context, receipts) => {
    const result = JSON.parse(await Shell.execute({ command: 'touch /mnt/should-not-exist; echo "1 pass"', verification: true }, context))
    expect(result.ok).toBe(false)
    expect(result.status).toBe('inconclusive')
    expect(result.output).toContain('detected project test command')
    await expect(access(join(root, 'should-not-exist'))).rejects.toThrow()
    const background = await Shell.execute({ command: 'bun run test', verification: true, background: true }, context)
    expect(background).toContain('foreground')
    expect(receipts).toHaveLength(1)
    expect(await Shell.execute({ command: 'bun run test', verification: true })).toContain('runtime verification ledger')
  })
})

sandboxTest('never records failed, empty, or changing tests as passed', async () => {
  for (const [test, expected] of [
    ["import { it, expect } from 'bun:test'; it('fails', () => expect(1).toBe(2))", 'failed'],
    [undefined, 'empty'],
    ["import { it, expect } from 'bun:test'; import { writeFileSync } from 'node:fs'; it('changes inputs', () => { writeFileSync('changed.txt', 'changed'); expect(1).toBe(1) })", 'failed'],
  ] as const) {
    await fixture(async (_root, context, receipts) => {
      const output = JSON.parse(await Shell.execute({ command: 'bun run test', verification: true }, context))
      expect(output.status).toBe(expected)
      expect(output.ok).toBe(false)
      expect(receipts[0]?.ok).toBe(false)
    }, test)
  }
})

sandboxTest('keeps receipt-producing verification read-only while allowing temporary files', async () => {
  await fixture(async (root, context, receipts) => {
    const target = join(root, 'verification-target.ts')
    const original = 'export const value = "original";\n'
    await writeFile(target, original)

    const result = JSON.parse(await Shell.execute({ command: 'bun run test', verification: true }, context))

    expect(result.status).not.toBe('passed')
    expect(result.ok).toBe(false)
    expect(receipts).toHaveLength(1)
    expect(receipts[0]?.status).not.toBe('passed')
    expect(await readFile(target, 'utf8')).toBe(original)
    expect(result.output).toContain('EROFS')
    expect(result.output).toContain('temporary files remain writable')
  }, `import { it, expect } from 'bun:test'; import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
const target = 'verification-target.ts';
it('temporary files remain writable', () => { const path = '/tmp/deepseek-verification-' + process.pid; writeFileSync(path, 'writable'); expect(readFileSync(path, 'utf8')).toBe('writable'); unlinkSync(path) });
it('cannot mutate and restore project inputs during verification', () => { const original = readFileSync(target, 'utf8'); let mutated = false; let observed = ''; try { writeFileSync(target, 'export const value = "mutated";\\n'); mutated = true; observed = readFileSync(target, 'utf8'); } finally { if (mutated) writeFileSync(target, original); } expect(observed).toContain('mutated'); });`)
})

sandboxTest('bounds the receipt preview and treats capture loss as inconclusive', async () => {
  await fixture(async (_root, context, receipts) => {
    const raw = await Shell.execute({ command: 'bun run test', verification: true }, context)
    const result = JSON.parse(raw)
    expect(result.status).toBe('inconclusive')
    expect(result.ok).toBe(false)
    expect(result.captureTruncated).toBe(true)
    expect(Buffer.byteLength(raw)).toBeLessThan(20_000)
    expect(result.previewComplete).toBe(false)
    expect(receipts[0]!.output.length).toBeGreaterThan(2_000)
    expect(receipts[0]!.output.length).toBeLessThan(2_001_000)
  }, "import { it, expect } from 'bun:test'; it('large diagnostics', () => { console.log('x'.repeat(2100000)); expect(1).toBe(1) })")
})

sandboxTest('records timeout and cancellation without claiming test success', async () => {
  await fixture(async (_root, context, receipts) => {
    const timed = JSON.parse(await Shell.execute({ command: 'bun run test', verification: true, timeout: 0.1 }, context))
    expect(timed.status).toBe('timed_out')
    expect(timed.ok).toBe(false)
    const controller = new AbortController()
    controller.abort(new Error('Stop verification'))
    const cancelled = JSON.parse(await Shell.execute({ command: 'bun run test', verification: true }, { ...context, signal: controller.signal }))
    expect(cancelled.status).toBe('cancelled')
    expect(cancelled.ok).toBe(false)
    expect(receipts.every(receipt => !receipt.ok)).toBe(true)
  }, "import { it } from 'bun:test'; it('waits', async () => { await new Promise(resolve => setTimeout(resolve, 10000)) })")
})

sandboxTest('lets a headless Agent register evidence and verify a test criterion through its normal tool gates', async () => {
  await fixture(async (root) => {
    const { Agent } = await import('../src/agent/agent.js')
    const { createGoal, getGoal, setGoal } = await import('../src/agent/goal.js')
    const agent = new Agent({ provider: 'local', localBaseUrl: 'http://127.0.0.1:65535/v1', localModel: 'fixture' }, { projectRoot: root, logFile: null, snapshotFile: null })
    try {
      await agent.readyPromise
      const internal = agent as any
      internal.settings = { risk: { enabled: false }, permissions: { allow: ['shell'] } }
      agent.setToolPermissionHandler(async request => request.reason === 'risk' ? 'once' : 'deny')
      const args = { command: 'bun run test', verification: true }
      const call = { id: 'headless-verification', type: 'function', function: { name: 'shell', arguments: JSON.stringify(args) } }
      const callbacks = { onToken() {}, onToolCall() {}, onToolResult() {}, onDone() {} }
      const execution = await internal.checkAndExecuteTool(call, args, callbacks)
      const receipt = JSON.parse(execution.result)
      expect(receipt.status).toBe('passed')
      expect(internal.sessionEvidence.latest('verification')?.id).toBe(receipt.evidenceId)
      createGoal('Run the project tests successfully.')
      internal.client = { chat: { completions: { create: async (request: any) => {
        const input = JSON.parse(request.messages[1].content)
        const value = input.sources ? { criteria: [{ text: 'Run project tests successfully.', source_id: 'objective', quote: 'Run the project tests successfully.', verification: 'test' }] }
          : { complete: true, explicit_completion: true, coverage_complete: true, reason: 'Actual test execution recorded.', criteria: [{ id: 'R1', status: 'satisfied', reason: 'The test executed in the sandbox.', evidence: [{ source_id: receipt.evidenceId, quote: '1 pass' }] }] }
        return { choices: [{ message: { content: JSON.stringify(value) } }], usage: {} }
      } } } }
      const outcome = JSON.parse(await internal.verifyGoalCompletion('The entire goal is complete; the project tests ran and passed.'))
      expect(outcome.success).toBe(true)
      expect(getGoal()?.status).toBe('complete')
      internal.settings.permissions = { deny: ['shell'] }
      const denied = await internal.checkAndExecuteTool({ ...call, id: 'denied-verification' }, args, callbacks)
      expect(JSON.parse(denied.result)).toMatchObject({ error: { kind: 'permission', code: 'POLICY_DENIED' } })
      expect(internal.sessionEvidence.latest('verification')?.id).toBe(receipt.evidenceId)
    } finally { setGoal(null); await agent.shutdown() }
  }, "import { it, expect } from 'bun:test'; it('contract', () => expect(1 + 1).toBe(2))")
})

sandboxTest('stores a worker-reported verification receipt in its own ledger and never invokes the parent recorder', async () => {
  await fixture(async (_root, context, receipts) => {
    const { runSubAgentLoop } = await import('../src/tools/SubAgent/executor.js')
    const { SessionEvidenceTool } = await import('../src/tools/SessionEvidence/SessionEvidence.js')
    let calls = 0
    let evidenceId = ''
    const verificationReceipt: VerificationResult = {
      command: { command: 'fixture', args: [], display: 'fixture' }, ok: true, status: 'passed', output: '1 passed',
      exitCode: 0, testCount: 1,
    }
    const workerVerificationTool: Tool = {
      ...Shell,
      async execute(_args, toolContext) {
        const id = toolContext?.recordVerification?.(verificationReceipt)
        if (!id) throw new Error('Worker verification ledger is unavailable')
        return JSON.stringify({ ...verificationReceipt, evidenceId: id })
      },
    }
    const result = await runSubAgentLoop('Recover the worker verification receipt.', 'Run the fixture verification tool and recover its receipt.', 'verification-worker', [workerVerificationTool, SessionEvidenceTool], { provider: 'local', localModel: 'fixture' }, 'fixture', {
      context: { ...context, recordVerification: () => { throw new Error('Parent recorder must not be invoked') } },
      callbacks: { permissionPolicy: 'isolated', permissions: { allow: ['shell', 'session_evidence'] } },
      client: { chat: { completions: { create: async (request: any) => {
        calls++
        let message: Record<string, unknown>
        if (calls === 1) message = { content: null, tool_calls: [{ id: 'verify', type: 'function', function: { name: 'shell', arguments: '{"command":"echo fixture verification"}' } }] }
        else if (calls === 2) {
          const response = JSON.parse(request.messages.find((entry: any) => entry.tool_call_id === 'verify').content)
          expect(response.status).toBe('passed')
          evidenceId = response.evidenceId
          message = { content: null, tool_calls: [{ id: 'recover', type: 'function', function: { name: 'session_evidence', arguments: JSON.stringify({ id: evidenceId }) } }] }
        } else {
          const recovered = JSON.parse(request.messages.find((entry: any) => entry.tool_call_id === 'recover').content)
          expect(recovered.id).toBe(evidenceId)
          expect(JSON.parse(recovered.text).status).toBe('passed')
          message = { content: 'Worker verification recovered.' }
        }
        return { choices: [{ message }], usage: {} }
      } } } } as any,
    })
    expect(result.resultText).toBe('Worker verification recovered.')
    expect(receipts).toHaveLength(0)
    expect(calls).toBe(3)
  }, "import { it, expect } from 'bun:test'; it('contract', () => expect(2 + 2).toBe(4))")
})

sandboxTest('reuses a current same-turn shell receipt instead of asking the UI to run the tests again', async () => {
  for (const mutateAfterVerification of [false, true]) await fixture(async (root) => {
    const { Agent } = await import('../src/agent/agent.js')
    const agent = new Agent({ provider: 'local', localBaseUrl: 'http://127.0.0.1:65535/v1', localModel: 'fixture' }, { projectRoot: root, logFile: null, snapshotFile: null })
    const previousHistory = process.env.DEEPSEEK_HISTORY_PATH
    process.env.DEEPSEEK_HISTORY_PATH = join(root, '.deepseek', 'verification-history.json')
    try {
      await agent.readyPromise
      const internal = agent as any
      internal.settings = { risk: { enabled: false }, permissions: { allow: ['shell'] }, memory: { enabled: false } }
      let requests = 0
      let hostVerificationRequests = 0
      agent.setToolPermissionHandler(async request => request.reason === 'risk' ? 'once' : 'deny')
      agent.setVerificationHandler(async () => { hostVerificationRequests++; if (!mutateAfterVerification) throw new Error('Duplicate host verification') })
      internal.client = { chat: { completions: { create: async (request: any) => {
        if (!request.stream) return { choices: [{ message: { content: '{"kind":"none","fact":""}' } }] }
        requests++
        const current = requests
        return (async function* () {
          if (current === 1) {
            // Simulate a completed edit; this test exercises the subsequent verification gate.
            await writeFile(join(root, 'updated.txt'), 'Updated source input')
            internal.turnModifiedFiles.add(join(root, 'updated.txt'))
            yield { choices: [{ delta: { tool_calls: [{ index: 0, id: 'verify-in-turn', type: 'function', function: { name: 'shell', arguments: '{"command":"bun run test","verification":true}' } }] }, finish_reason: 'tool_calls' }] }
          } else {
            if (mutateAfterVerification) await writeFile(join(root, 'after-test.txt'), 'Changed after verification')
            yield { choices: [{ delta: { content: 'The test execution is recorded.' }, finish_reason: 'stop' }] }
          }
        })()
      } } } }
      await agent.run('Verify the changed project.', { onToken() {}, onToolCall() {}, onToolResult() {}, onDone() {} })
      expect(requests).toBe(2)
      expect(hostVerificationRequests).toBe(mutateAfterVerification ? 1 : 0)
      const receipt = JSON.parse(internal.sessionEvidence.latest('verification').text)
      expect(receipt.status).toBe('passed')
      expect(receipt.finalDigest === (await captureWorkspaceVersion(root)).digest).toBe(!mutateAfterVerification)
    } finally {
      if (previousHistory === undefined) delete process.env.DEEPSEEK_HISTORY_PATH
      else process.env.DEEPSEEK_HISTORY_PATH = previousHistory
      await agent.shutdown()
    }
  }, "import { it, expect } from 'bun:test'; it('contract', () => expect(3 + 3).toBe(6))")
})

sandboxTest('honors the configured test script inside the sandbox and rejects the bypassing builtin command', async () => {
  await fixture(async (root, context) => {
    await writeFile(join(root, 'excluded.test.ts'), "import { it, expect } from 'bun:test'; it('excluded suite must not run', () => expect(1).toBe(2))")
    await writeFile(join(root, 'package.json'), JSON.stringify({ scripts: { test: `bun -e 'console.log("sandbox setup ran")' && bun test ./contract.test.ts` } }))
    const bypass = JSON.parse(await Shell.execute({ command: 'bun test', verification: true }, context))
    expect(bypass.status).toBe('inconclusive')
    expect(bypass.output).toContain('exact detected project test command')
    const result = JSON.parse(await Shell.execute({ command: 'bun run test', verification: true }, context))
    expect(result.status).toBe('inconclusive')
    expect(result.testCount).toBeNull()
    expect(result.output).toContain('sandbox setup ran')
    expect(result.output).not.toContain('excluded suite must not run')
  }, "import { it, expect } from 'bun:test'; it('selected contract', () => expect(7 + 7).toBe(14))")
})

sandboxTest('does not accept a project venv shell wrapper as pytest evidence', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'deepseek-shell-python-verification-'))
  const root = join(parent, 'project with spaces')
  await mkdir(root)
  const receipts: VerificationResult[] = []
  const context = { sessionId: 'python-verification-fixture', workspacePath: root, projectRoot: root, permissionProfile: 'coordinator-integrator' as const,
    recordVerification: (result: VerificationResult) => { receipts.push(result); return 'recorded-receipt' },
  }
  try {
    await writeFile(join(root, 'pytest.ini'), '[pytest]\ntestpaths = tests\n')
    const makePython = async (environment: string, summary: string) => {
      const executable = join(root, environment, 'bin', 'python')
      await mkdir(join(root, environment, 'bin'), { recursive: true })
      await writeFile(executable, `#!/bin/sh\n[ "$1" = "-I" ] && [ "$2" = "-m" ] && [ "$3" = "pytest" ] || exit 22\nprintf '%s\\n' ${JSON.stringify(summary)}\n`)
      await chmod(executable, 0o755)
    }
    await makePython('.venv', '1 passed in 0.01s')
    await makePython('venv', '0 passed')
    const command = await detectVerificationCommand(root)
    expect(command?.command).toBe(join(root, '.venv', 'bin', 'python'))
    const result = JSON.parse(await Shell.execute({ command: command!.display, verification: true }, context))
    expect(result.status).toBe('inconclusive')
    expect(result.testCount).toBeNull()
    expect(result.output).toContain('1 passed in 0.01s')
    expect(result.output).not.toContain('0 passed')
    expect(receipts).toHaveLength(1)
  } finally { await rm(parent, { recursive: true, force: true }) }
})

sandboxTest('finds the runtime inside the sandbox when the host HOME differs from its installation directory', async () => {
  await fixture(async (root) => {
    const script = `import { Shell } from ${JSON.stringify(new URL('../src/tools/Shell/Shell.ts', import.meta.url).href)};
      console.log(await Shell.execute({command:'bun run test',verification:true},{sessionId:'home-fixture',workspacePath:${JSON.stringify(root)},projectRoot:${JSON.stringify(root)},permissionProfile:'coordinator-integrator',recordVerification:()=> 'receipt'}));`
    const child = Bun.spawn([process.execPath, '-e', script], { env: { ...scrubbedEnv(), HOME: join(root, 'isolated-home') }, stdout: 'pipe', stderr: 'pipe' })
    const [output, error, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    expect(error).toBe('')
    expect(exit).toBe(0)
    const result = JSON.parse(output)
    expect(result.status).toBe('passed')
    expect(result.exitCode).toBe(0)
    expect(result.testCount).toBe(1)
  }, "import { it, expect } from 'bun:test'; it('runtime available', () => expect(5 + 5).toBe(10))")
})
