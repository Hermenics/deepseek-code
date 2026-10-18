import { afterEach, expect, it } from 'bun:test'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Agent, fileCheckpointSessionKey } from '../src/agent/agent.js'
import { createFileCheckpoint, markFileCheckpointWritten } from '../src/agent/fileCheckpoint.js'
import { SessionEvidence } from '../src/agent/sessionEvidence.js'
import { redactSecrets } from '../src/orchestration/events.js'
import { restoreBotTranscript } from '../src/bots/worker.js'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

it('restores bot file receipts only when the checkpoint manifest verifies them', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deepseek-bot-receipt-'))
  roots.push(root)
  const previousHome = process.env.HOME
  process.env.HOME = join(root, 'home')
  const projectRoot = join(root, 'project')
  await mkdir(projectRoot, { recursive: true })
  const sessionId = `bot:fixture:${randomUUID()}`
  const agent = new Agent({ provider: 'local', localModel: 'fixture' }, {
    projectRoot, logFile: null, snapshotFile: null, sessionId,
  })

  try {
    await agent.readyPromise
    const path = join(projectRoot, 'report.txt'), callId = 'bot-write-call'
    const args = { path, content: 'report' }
    await writeFile(path, 'before')
    const checkpointId = await createFileCheckpoint(fileCheckpointSessionKey(sessionId), path, 'write_file')
    await writeFile(path, args.content)
    const postVersion = { exists: true, hash: createHash('sha256').update(args.content).digest('hex') }
    await markFileCheckpointWritten(fileCheckpointSessionKey(sessionId), checkpointId, postVersion)

    const transcript = (receiptCheckpointId: string) => {
      const evidence = new SessionEvidence()
      const argsDigest = createHash('sha256').update(JSON.stringify(redactSecrets(args))).digest('hex')
      evidence.add('tool', `file-effect-outcome:${callId}`, JSON.stringify({
        state: 'effect-observed', effectId: callId, toolCallId: callId, toolName: 'write_file',
        argsDigest, requestedPath: path, checkpointId: receiptCheckpointId, path, postVersion,
      }))
      return [
        { role: 'system' as const, content: (agent as any).systemPrompt },
        { role: 'assistant' as const, content: null, tool_calls: [
          { id: callId, type: 'function' as const, function: { name: 'write_file', arguments: JSON.stringify(args) } },
        ] },
        evidence.snapshot(),
      ]
    }

    await restoreBotTranscript(agent, transcript(checkpointId))
    const verified = String(agent.getMessages().find(message => message.role === 'tool' && message.tool_call_id === callId)?.content)
    expect(verified).toContain('effect-observed')

    await restoreBotTranscript(agent, transcript('different-checkpoint'))
    const mismatch = String(agent.getMessages().find(message => message.role === 'tool' && message.tool_call_id === callId)?.content)
    expect(mismatch).toContain('may have executed')
    expect(mismatch).not.toContain('effect-observed')

    await writeFile(join(process.env.HOME!, '.deepseek-code', 'checkpoints', fileCheckpointSessionKey(sessionId), 'manifest.json'), '{invalid')
    await expect(restoreBotTranscript(agent, transcript(checkpointId))).resolves.toBeUndefined()
    const unreadable = String(agent.getMessages().find(message => message.role === 'tool' && message.tool_call_id === callId)?.content)
    expect(unreadable).toContain('may have executed')
    expect(unreadable).not.toContain('effect-observed')
  } finally {
    await agent.shutdown()
    if (previousHome === undefined) delete process.env.HOME
    else process.env.HOME = previousHome
  }
})
