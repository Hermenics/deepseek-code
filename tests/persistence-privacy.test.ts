import { afterEach, describe, expect, it } from 'bun:test'
import { createHash } from 'node:crypto'
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { redactSecrets, TaskEventSink } from '../src/orchestration/events.js'

let tempHome: string | undefined
let previousHome: string | undefined
let previousUserProfile: string | undefined

afterEach(async () => {
  if (tempHome) {
    if (previousHome === undefined) delete process.env.HOME
    else process.env.HOME = previousHome
    if (previousUserProfile === undefined) delete process.env.USERPROFILE
    else process.env.USERPROFILE = previousUserProfile
    await rm(tempHome, { recursive: true, force: true })
  }
  tempHome = undefined
  previousHome = undefined
})

async function useTemporaryHome(): Promise<string> {
  previousHome = process.env.HOME
  tempHome = await mkdtemp(join(tmpdir(), 'deepseek-persistence-privacy-'))
  process.env.HOME = tempHome
  previousUserProfile = process.env.USERPROFILE
  process.env.USERPROFILE = tempHome
  return tempHome
}

describe('persistent secret redaction', () => {
  it('redacts inline JSON and credential assignments while preserving ordinary strings', () => {
    const inline = '{"apiKey":"inline-canary","refreshToken":"refresh-canary","normal":"keep me"}'
    const malformed = 'historical malformed args: apiKey = assignment-canary'
    const bearer = 'Authorization: Bearer header-canary'
    expect(redactSecrets(inline)).toBe('{"apiKey":"[REDACTED]","refreshToken":"[REDACTED]","normal":"keep me"}')
    expect(redactSecrets(malformed)).toBe('historical malformed args: apiKey = [REDACTED]')
    expect(redactSecrets(bearer)).not.toContain('header-canary')
    expect(redactSecrets('ordinary historical text')).toBe('ordinary historical text')
    expect(redactSecrets({ userAccessToken: 'camel-canary', promptTokens: 12, completionTokens: 4, tokenCount: 9 })).toEqual({
      userAccessToken: '[REDACTED]', promptTokens: 12, completionTokens: 4, tokenCount: 9,
    })
    expect(redactSecrets('userAccessToken=camel-assignment-canary')).toBe('userAccessToken=[REDACTED]')
    const nested = JSON.stringify([{ text: 'Use api_key="quoted-canary" and preserve the request.' }])
    const first = redactSecrets(nested) as string
    expect(JSON.parse(first)[0].text).toContain('[REDACTED]')
    expect(first).not.toContain('quoted-canary')
    expect(redactSecrets(first)).toBe(first)
    expect(redactSecrets('{ "ordinary": [1, 2] }')).toBe('{ "ordinary": [1, 2] }')
  })

  it('scans long ordinary text linearly and still redacts a credential at the end', () => {
    const input = `${'ordinaryword '.repeat(30_000)} apiKey=late-canary`
    const started = performance.now()
    const redacted = redactSecrets(input) as string
    const elapsed = performance.now() - started
    expect(redacted).toEndWith('apiKey=[REDACTED]')
    expect(redacted).not.toContain('late-canary')
    // A broad ceiling catches accidental backtracking without relying on
    // truncation or skipping the tail of a large value.
    expect(elapsed).toBeLessThan(1_000)
  })

  it('sanitizes session and checkpoint file copies with owner-only permissions without mutating live input', async () => {
    const home = await useTemporaryHome()
    const { saveSession } = await import('../src/agent/session.js')
    const { saveCheckpoint } = await import('../src/agent/checkpoint.js')
    const sessionContent = '{"apiKey":"session-json-canary","note":"preserve"}'
    const malformedContent = 'historical malformed content apiKey=session-assignment-canary'
    const session = {
      id: '0123456789ab',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      cwd: '/tmp/privacy-workspace',
      model: 'deepseek-chat',
      provider: 'deepseek',
      language: null,
      activeAgent: null,
      agentMessages: [
        { role: 'user' as const, content: sessionContent },
        { role: 'assistant' as const, content: malformedContent },
      ],
      uiMessages: [{ role: 'user' as const, content: sessionContent }],
      filesModified: [],
      usage: { promptTokens: 123, completionTokens: 45 },
    }
    const workspaceHash = createHash('sha256').update(session.cwd).digest('hex').slice(0, 8)
    await saveSession(session)
    const sessionPath = join(home, '.deepseek', 'sessions', `${basename(session.cwd)}-${workspaceHash}`, `${session.id}.json`)
    const sessionRaw = await readFile(sessionPath, 'utf8')
    const persistedSession = JSON.parse(sessionRaw)
    expect(sessionRaw).not.toContain('session-json-canary')
    expect(sessionRaw).not.toContain('session-assignment-canary')
    expect(persistedSession.agentMessages[0].content).toBe('{"apiKey":"[REDACTED]","note":"preserve"}')
    expect(persistedSession.agentMessages[1].content).toBe('historical malformed content apiKey=[REDACTED]')
    expect(persistedSession.usage).toEqual({ promptTokens: 123, completionTokens: 45 })
    expect(session.agentMessages[0]!.content).toBe(sessionContent)
    expect(session.uiMessages[0]!.content).toBe(sessionContent)
    if (process.platform !== 'win32') expect((await stat(sessionPath)).mode & 0o777).toBe(0o600)

    const checkpointMessage = '{"authorization":"Bearer checkpoint-json-canary","ok":true}'
    const messages = [{ role: 'tool' as const, tool_call_id: 'call-1', content: checkpointMessage }]
    const checkpointId = await saveCheckpoint(messages, [], 'apiKey=checkpoint-label-canary')
    const checkpointPath = join(home, '.deepseek', 'checkpoints', `${checkpointId}.json`)
    const checkpointRaw = await readFile(checkpointPath, 'utf8')
    const persistedCheckpoint = JSON.parse(checkpointRaw)
    expect(checkpointRaw).not.toContain('checkpoint-json-canary')
    expect(checkpointRaw).not.toContain('checkpoint-label-canary')
    expect(persistedCheckpoint.messages[0].content).toBe('{"authorization":"[REDACTED]","ok":true}')
    expect(messages[0]!.content).toBe(checkpointMessage)
    if (process.platform !== 'win32') expect((await stat(checkpointPath)).mode & 0o777).toBe(0o600)
  })

  it('writes redacted malformed credential history to event logs', async () => {
    const home = await useTemporaryHome()
    const logPath = join(home, 'events.jsonl')
    await writeFile(logPath, '', { mode: 0o644 })
    await chmod(logPath, 0o644)
    const events = new TaskEventSink('privacy-session', logPath)
    events.emit('tool_finished', { arguments: 'historical malformed JSON: {"apiKey":"event-canary', output: 'done' })
    await events.flush()
    const log = await readFile(logPath, 'utf8')
    expect(log).not.toContain('event-canary')
    expect(JSON.parse(log).payload.arguments).toContain('apiKey":"[REDACTED]')
    if (process.platform !== 'win32') expect((await stat(logPath)).mode & 0o777).toBe(0o600)
  })

  it('redacts secrets when reading a legacy session without rewriting its file', async () => {
    const home = await useTemporaryHome()
    const { loadSession } = await import('../src/agent/session.js')
    const id = 'abcdef123456'
    const cwd = '/tmp/legacy-privacy-workspace'
    const path = join(home, '.deepseek', 'sessions', `${id}.json`)
    const legacy = {
      id, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', cwd,
      model: 'fixture', provider: 'local', language: null, activeAgent: null,
      agentMessages: [{ role: 'user', content: 'api_key=legacy-session-canary' }],
      uiMessages: [{ role: 'user', content: 'api_key=legacy-session-canary' }], filesModified: [],
    }
    await mkdir(join(home, '.deepseek', 'sessions'), { recursive: true })
    await writeFile(path, JSON.stringify(legacy))

    const loaded = await loadSession(id, cwd)

    expect(JSON.stringify(loaded)).not.toContain('legacy-session-canary')
    expect(loaded?.uiMessages[0]?.content).toBe('api_key=[REDACTED]')
    expect((await readFile(path, 'utf8'))).toContain('legacy-session-canary')
  })
})

it('round-trips source-cited goal criteria and source snapshots through session storage', async () => {
  await useTemporaryHome()
  const { saveSession, loadSession } = await import('../src/agent/session.js')
  const { SessionEvidence } = await import('../src/agent/sessionEvidence.js')
  const { parseGoalCriteria, validateGoalCriteria } = await import('../src/agent/goalAcceptance.js')
  const ledger = new SessionEvidence()
  const source = ledger.add('request', 'user', 'Preserve output. api_key=criterion-persistence-canary')
  const sources = ledger.completionConstraints()
  const acceptanceCriteria = parseGoalCriteria(JSON.stringify({ criteria: [{ text: 'Preserve output.', source_id: source, quote: sources[0]!.text, verification: 'inspection' }] }), sources, 'a'.repeat(64))
  const now = new Date().toISOString()
  const session = {
    id: 'abcdef123456', createdAt: now, updatedAt: now, cwd: '/tmp/criterion-persistence-fixture', model: 'fixture', provider: 'local', language: null, activeAgent: null,
    agentMessages: [ledger.snapshot()], uiMessages: [], filesModified: [],
    goal: { objective: 'Preserve output.', status: 'active' as const, acceptanceCriteria, tokensUsed: 0, timeUsedSeconds: 0, consecutiveBlockCount: 0, continuations: 0, createdAt: now, updatedAt: now, startedAt: now },
  }
  await saveSession(session)
  const saved = await loadSession(session.id, session.cwd)
  expect(JSON.stringify(saved)).not.toContain('criterion-persistence-canary')
  const restored = new SessionEvidence()
  restored.restore(saved!.agentMessages)
  expect(restored.completionConstraints()).toEqual(sources)
  expect(validateGoalCriteria(saved!.goal!.acceptanceCriteria!, restored.completionConstraints())).toEqual(acceptanceCriteria)
})
