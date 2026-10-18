import { expect, it } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Agent } from '../src/agent/agent.js'
import { createGoal, setGoal } from '../src/agent/goal.js'

const callbacks = { onToken() {}, onToolCall() {}, onToolResult() {}, onDone() {} }

it('recovers an old decisive read after real compaction and resume despite an incorrect summary', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deepseek-evidence-compact-'))
  const options = { projectRoot: root, logFile: null, snapshotFile: null }
  const provider = { provider: 'local' as const, localModel: 'fixture' }
  const agent = new Agent(provider, options)
  let resumed: Agent | undefined
  try {
    await agent.readyPromise
    createGoal('Preserve the configured development port and complete the whole requested task.')
    const internal = agent as any
    internal.settings = { risk: { enabled: false } }
    const path = join(root, 'config.txt')
    await writeFile(path, 'Development port: 4100\n' + 'Recorded source content.\n'.repeat(30))
    const call = { id: 'decisive-read', type: 'function' as const, function: { name: 'read_file', arguments: JSON.stringify({ path }) } }
    const read = await internal.checkAndExecuteTool(call, { path }, callbacks)
    expect(read.result).toContain('Development port: 4100')
    const source = internal.sessionEvidence.latest('read_file:decisive-read')
    expect(source).toBeDefined()
    const originalToolSources = internal.sessionEvidence.toolSources().length
    const claimCall = async (args: Record<string, unknown>, id: string) => internal.checkAndExecuteTool(
      { id, type: 'function', function: { name: 'record_claim', arguments: JSON.stringify(args) } }, args, callbacks,
    )
    const hypothesis = JSON.parse((await claimCall({ statement: 'The configured port is 3000.', status: 'hypothesis', evidence: [] }, 'hypothesis')).result)
    const refutation = JSON.parse((await claimCall({ statement: 'The configured port is 3000.', status: 'refuted', supersedes: hypothesis.id, evidence: [{ id: source.id, excerpt: 'Development port: 4100' }] }, 'refutation')).result)
    expect(refutation.id).toBeTruthy()
    expect(internal.sessionEvidence.toolSources()).toHaveLength(originalToolSources)
    internal.sessionEvidence.add('request', 'user', 'Use the configured development port.')
    for (let index = 0; index < 12; index++) internal.sessionEvidence.add('tool', `read_file:later-${index}`, 'Unrelated later source')
    internal.messages.push(
      { role: 'user', content: 'Use the configured development port.' },
      { role: 'assistant', content: null, tool_calls: [call] },
      { role: 'tool', tool_call_id: call.id, content: read.result },
    )
    let compactions = 0
    internal.client = { chat: { completions: { create: async (request: any) => {
      compactions++
      expect(request.messages[1].content).toContain('Development port: 4100')
      return { choices: [{ message: { content: Array.from({ length: 9 }, (_, index) => `## ${index + 1}. Section\nThe port is 3000.`).join('\n') } }] }
    } } } }
    await agent.compact()
    expect(compactions).toBe(1)
    expect(JSON.stringify(agent.getMessages())).toContain('Preserve the configured development port and complete the whole requested task.')
    const raw = agent.getRawMessages()
    expect(agent.getMessages().some(message => String(message.content).includes('Development port: 4100'))).toBe(false)
    resumed = new Agent(provider, options)
    await resumed.readyPromise
    await resumed.loadSessionMessages(raw)
    await resumed.readyPromise
    expect(JSON.stringify(resumed.getMessages())).toContain('Preserve the configured development port and complete the whole requested task.')
    const recovered = resumed as any
    recovered.settings = { risk: { enabled: false } }
    const restoredToolSources = recovered.sessionEvidence.toolSources().length
    expect(JSON.stringify(resumed.getMessages())).toMatch(/\d+ tool references omitted/)
    expect(JSON.stringify(resumed.getMessages())).toContain(`refuted ${refutation.id}`)
    const oldClaim = JSON.parse((await recovered.checkAndExecuteTool(
      { id: 'old-claim', type: 'function', function: { name: 'session_evidence', arguments: JSON.stringify({ id: hypothesis.id }) } }, { id: hypothesis.id }, callbacks,
    )).result)
    expect(oldClaim.claimState).toEqual({ currentId: refutation.id, status: 'refuted', superseded: true })
    expect(recovered.sessionEvidence.toolSources()).toHaveLength(restoredToolSources)
    const recover = async (args: Record<string, unknown>, id: string) => recovered.checkAndExecuteTool(
      { id, type: 'function', function: { name: 'session_evidence', arguments: JSON.stringify(args) } }, args, callbacks,
    )
    const index = JSON.parse((await recover({}, 'index')).result)
    expect(index.text).toContain(source.id)
    const record = JSON.parse((await recover({ id: source.id }, 'recover')).result)
    expect(record.text).toContain('Development port: 4100')
    expect(record.text).not.toContain('The port is 3000')
    expect(recovered.sessionEvidence.toolSources()).toHaveLength(restoredToolSources)
    await writeFile(path, 'Development port: 4300\n')
    const fresh = await recovered.checkAndExecuteTool({ ...call, id: 'fresh-read' }, { path }, callbacks)
    expect(fresh.result).toContain('Development port: 4300')
    expect(JSON.parse((await recover({ id: source.id }, 'history')).result).text).toContain('Development port: 4100')
  } finally {
    setGoal(null)
    await resumed?.shutdown()
    await agent.shutdown()
    await rm(root, { recursive: true, force: true })
  }
})

it('keeps a denied action historical across compaction and requires fresh consent after resume', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deepseek-denial-resume-'))
  const options = { projectRoot: root, logFile: null, snapshotFile: null }
  const provider = { provider: 'local' as const, localModel: 'fixture' }
  const agent = new Agent(provider, options)
  let resumed: Agent | undefined
  try {
    await agent.readyPromise
    const internal = agent as any
    internal.settings = { risk: { enabled: false } }
    internal.allowedTools = '*'
    let executions = 0
    internal.executeTool = async () => { executions++; return 'executed' }
    agent.setToolPermissionHandler(async () => 'deny')
    const call = { id: 'denied-introspect', type: 'function' as const, function: { name: 'introspect', arguments: '{}' } }
    await expect(internal.checkAndExecuteTool(call, {}, callbacks)).rejects.toThrow()
    expect(internal.sessionEvidence.completionConstraints().filter((entry: { kind: string }) => entry.kind === 'denial')).toHaveLength(1)

    internal.messages.push({ role: 'user', content: 'Inspect available tools without bypassing the denied action.' })
    let compactInput = ''
    internal.client = { chat: { completions: { create: async (request: any) => {
      compactInput = request.messages[1].content
      return { choices: [{ message: { content: Array.from({ length: 9 }, (_, index) => `## ${index + 1}. Section\nThe denied action remains unauthorized.`).join('\n') } }] }
    } } } }
    await agent.compact()
    expect(compactInput).toContain('Inspect available tools')

    resumed = new Agent(provider, options)
    await resumed.readyPromise
    await resumed.loadSessionMessages(agent.getRawMessages())
    await resumed.readyPromise
    const restored = resumed as any
    restored.settings = { risk: { enabled: false } }
    restored.allowedTools = '*'
    const denial = restored.sessionEvidence.completionConstraints().find((entry: { kind: string }) => entry.kind === 'denial')
    expect(denial).toBeDefined()
    expect(JSON.parse(denial.text).reason).toBe('user refused or aborted authorization')
    expect(restored.sessionEvidence.activeSessionGrants()).toEqual([])
    expect(resumed.getPermissionsInfo().sessionApproved).toEqual([])

    let prompts = 0
    resumed.setToolPermissionHandler(async () => { prompts++; return 'once' })
    restored.executeTool = async () => { executions++; return 'executed' }
    const fresh = await restored.checkAndExecuteTool({ ...call, id: 'fresh-introspect' }, {}, callbacks)
    expect(prompts).toBe(1)
    expect(executions).toBe(1)
    expect(fresh.result).toBe('executed')
    expect(restored.sessionEvidence.completionConstraints().some((entry: { kind: string }) => entry.kind === 'denial')).toBe(true)
  } finally {
    await resumed?.shutdown()
    await agent.shutdown()
    await rm(root, { recursive: true, force: true })
  }
})
