import { describe, expect, it } from 'bun:test'
import { createBoundaryMarker } from '../src/agent/compactBoundary.js'
import { SessionEvidence, toolReplayArgsDigest } from '../src/agent/sessionEvidence.js'
import { SessionEvidenceTool } from '../src/tools/SessionEvidence/SessionEvidence.js'
import { canUseTool } from '../src/ui/interactionMode.js'

describe('session source evidence', () => {
  it('persists deduplicated interrupted replay digests across a compacted session restore', () => {
    const ledger = new SessionEvidence()
    const args = { path: 'reports/é.txt', content: 'token=private-replay-canary' }
    const replay = ledger.recordPendingToolReplay('write_file', args)
    ledger.recordPendingToolReplay('write_file', { content: 'token=private-replay-canary', path: 'reports/e\u0301.txt' })
    const snapshot = ledger.snapshot()
    const entries = JSON.parse(snapshot.content as string)

    expect(replay.argsDigest).toBe(toolReplayArgsDigest({ content: 'token=private-replay-canary', path: 'reports/e\u0301.txt' }))
    expect(entries.filter((entry: { kind: string }) => entry.kind === 'pending_replay')).toHaveLength(1)
    expect(snapshot.content).not.toContain('private-replay-canary')
    expect(snapshot.content).toContain(replay.argsDigest)

    const compactedMessages = [
      { role: 'system' as const, content: 'Current system prompt' },
      { role: 'user' as const, content: 'Compacted conversation summary' },
      createBoundaryMarker(),
      snapshot,
    ]
    const restored = new SessionEvidence()
    restored.restore(compactedMessages)
    expect(restored.pendingToolReplayRecords()).toEqual([replay])
    expect(restored.hasPendingToolReplay('write_file', replay.argsDigest)).toBe(true)
    expect(restored.resolvePendingToolReplay(replay)).toBe(true)
    expect(restored.hasPendingToolReplay('write_file', replay.argsDigest)).toBe(false)
  })

  it('bounds pending replay records and fails closed after overflow', () => {
    const ledger = new SessionEvidence()
    for (let index = 0; index < 140; index++) ledger.recordPendingToolReplay('read_file', { path: `file-${index}` })

    expect(ledger.pendingToolReplayRecords()).toHaveLength(128)
    expect(ledger.hasPendingToolReplay('unrelated_tool', 'f'.repeat(64))).toBe(true)
    expect(ledger.snapshot().content).toContain('pending-tool-replay-overflow')
  })

  it('manifests omitted source references and supports a tool-only restored session', () => {
    const ledger = new SessionEvidence()
    const old = ledger.add('tool', 'read_file:decisive', 'Older decisive source')
    for (let index = 0; index < 10; index++) ledger.add('tool', `read_file:${index}`, `Recent ${index}`)
    for (let index = 0; index < 10; index++) ledger.add('request', 'user', `Request ${index}`)
    expect(ledger.context()).toContain('1 constraint previews and 3 tool references omitted')
    expect(ledger.context()).not.toContain(old)
    expect(JSON.parse(ledger.read()).text).toContain(old)
    expect(JSON.parse(ledger.read(old)).text).toBe('Older decisive source')
    const toolOnly = new SessionEvidence()
    toolOnly.add('tool', 'read_file:only', 'Original content')
    const restored = new SessionEvidence()
    restored.restore([toolOnly.snapshot()])
    expect(restored.context()).toContain('1 tool sources, 0 session grant events retained')
    expect(restored.context()).toContain('Historical tool source')
    expect(restored.context()).toContain('revalidate current state')
  })

  it('keeps original requests, corrections and denials separate from summaries across resume', () => {
    const ledger = new SessionEvidence()
    const objective = ledger.add('request', 'user', 'Only edit the library. Preserve public behavior.')
    ledger.add('denial', 'shell', 'Deploy denied by user')
    ledger.add('request', 'user', 'Correction: also update its documentation')
    const restored = new SessionEvidence()
    const ordinary = { role: 'assistant' as const, content: 'A potentially inaccurate summary' }
    expect(restored.restore([ordinary, ledger.snapshot()])).toEqual([ordinary])
    expect(JSON.parse(restored.read(objective)).text).toBe('Only edit the library. Preserve public behavior.')
    expect(restored.context()).toContain(objective)
    expect(restored.context()).toContain('never grants')
    expect(restored.context()).toContain('Correction:')
  })

  it('keeps a bounded preview of the original objective after later requests exceed the context window', () => {
    const ledger = new SessionEvidence()
    const objectiveText = `Preserve the public API while updating the entire library. ${'detail '.repeat(80)}END-OF-OBJECTIVE`
    const objectiveId = ledger.add('request', 'user', objectiveText)
    for (let index = 0; index < 8; index++) ledger.add('request', 'user', `Later request ${index}`)

    const context = ledger.context()
    expect(context).toContain(`Original objective: ${objectiveId}`)
    expect(context).toContain('Preserve the public API while updating the entire library.')
    expect(context).not.toContain('END-OF-OBJECTIVE')
    expect(context).toContain('0 constraint previews and 0 tool references omitted')
  })

  it('records typed session grants as audit data and expires them when evidence is restored', () => {
    const ledger = new SessionEvidence()
    ledger.recordSessionGrant('tool', 'web_fetch@https://example.com')
    ledger.recordSessionGrant('directory', '/tmp/approved')
    expect(ledger.activeSessionGrants()).toHaveLength(2)
    const grantIds = JSON.parse(ledger.snapshot().content as string).filter((entry: { kind: string }) => entry.kind === 'grant').map((entry: { id: string }) => entry.id)

    const restored = new SessionEvidence()
    restored.restore([ledger.snapshot()])
    expect(restored.activeSessionGrants()).toEqual([])
    for (const id of grantIds) expect(JSON.parse(restored.read(id)).grantState).toMatchObject({ status: 'expired', reason: 'session-resumed' })
    expect(JSON.parse(restored.read()).text).toContain('"status":"expired"')
    expect(JSON.parse(restored.read()).text).toContain('web_fetch@https://example.com')
    expect(restored.context()).toContain('Grant records are historical audit data')
    expect(restored.completionConstraints()).toEqual([])
  })

  it('restores typed authorization decisions without persisting tool arguments', () => {
    const ledger = new SessionEvidence()
    ledger.recordAuthorizationDecision({
      actor: 'user', decision: 'allow', scope: 'call', reason: 'risk',
      subjectHash: 'a'.repeat(64), toolName: 'shell', toolCallId: 'call-allow',
    })
    ledger.recordAuthorizationDecision({
      actor: 'permission-hook', decision: 'block', scope: 'call', reason: 'permission',
      subjectHash: 'b'.repeat(64), toolName: 'write_file',
    })
    const snapshot = ledger.snapshot()
    const entries = JSON.parse(snapshot.content as string)
    expect(entries.filter((entry: { kind: string }) => entry.kind === 'authorization')).toHaveLength(2)
    expect(snapshot.content).not.toContain('args')

    const restored = new SessionEvidence()
    restored.restore([snapshot])
    expect(restored.read()).toContain('authorization authorization-decision')
    expect(restored.context()).toContain('2 authorization decisions retained')
    expect(JSON.parse(restored.snapshot().content as string).filter((entry: { kind: string }) => entry.kind === 'authorization').map((entry: { text: string }) => JSON.parse(entry.text).toolCallId)).toEqual(['call-allow', undefined])

    entries[0].text = JSON.stringify({ ...JSON.parse(entries[0].text), actor: 'permission-hook', decision: 'deny' })
    expect(() => new SessionEvidence().restore([{ ...snapshot, content: JSON.stringify(entries) }])).toThrow('permission hook decision')
  })

  it('closes only matching current grants and rejects malformed persisted grant events', () => {
    const ledger = new SessionEvidence()
    ledger.recordSessionGrant('tool', 'web_fetch@https://example.com')
    ledger.recordSessionGrant('tool', 'shell')
    const web = JSON.parse(ledger.snapshot().content as string).find((entry: { kind: string; text: string }) => entry.kind === 'grant' && JSON.parse(entry.text).subject === 'web_fetch@https://example.com').id
    ledger.endSessionGrants('revoked', 'explicit-clear', 'tool', 'web_fetch@https://example.com')
    expect(ledger.activeSessionGrants().map(grant => grant.subject)).toEqual(['shell'])
    expect(JSON.parse(ledger.read(web)).grantState).toMatchObject({ status: 'revoked', reason: 'explicit-clear' })

    const settingsLedger = new SessionEvidence()
    settingsLedger.recordSessionGrant('tool', 'introspect')
    settingsLedger.endSessionGrants('revoked', 'settings-changed')
    const restoredSettingsLedger = new SessionEvidence()
    restoredSettingsLedger.restore([settingsLedger.snapshot()])
    expect(restoredSettingsLedger.activeSessionGrants()).toEqual([])

    const snapshot = ledger.snapshot()
    const entries = JSON.parse(snapshot.content as string)
    entries.push({ id: '00000000-0000-4000-8000-000000000099', kind: 'grant', source: 'session-grant', text: JSON.stringify({ grantId: 'not-a-uuid', status: 'active', scope: 'tool', subject: 'shell', at: new Date().toISOString() }) })
    expect(() => new SessionEvidence().restore([{ ...snapshot, content: JSON.stringify(entries) }])).toThrow('grant')
  })

  it('redacts secrets before persistence or source recovery', () => {
    const ledger = new SessionEvidence()
    const id = ledger.add('request', 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456', 'Use Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456')
    expect(ledger.snapshot().content).not.toContain('abcdefghijklmnopqrstuvwxyz123456')
    expect(ledger.read(id)).not.toContain('abcdefghijklmnopqrstuvwxyz123456')
    expect(ledger.context()).not.toContain('abcdefghijklmnopqrstuvwxyz123456')
    const structuredId = ledger.add('denial', 'tool', JSON.stringify({ args: { api_key: 'secret-value-123' }, reason: 'denied' }))
    expect(ledger.snapshot().content).not.toContain('secret-value-123')
    expect(ledger.read(structuredId)).not.toContain('secret-value-123')
  })

  it('recovers long sources in bounded Unicode-safe slices', () => {
    const ledger = new SessionEvidence()
    const text = '😀α'.repeat(12000)
    const id = ledger.add('tool', 'read_file:file.ts', text)
    let start = 0, recovered = ''
    do {
      const part = JSON.parse(ledger.read(id, start, 19999))
      expect(part.text.length).toBeLessThanOrEqual(19999)
      expect(ledger.read(id, start, 19999).length).toBeLessThanOrEqual(20_000)
      recovered += part.text
      start = part.next
    } while (start !== null)
    expect(recovered).toBe(text)
    expect(() => ledger.read(id, 1)).toThrow('Unicode boundary')
    expect(() => ledger.read('unknown')).toThrow('Unknown')
    expect(() => ledger.read(id, 0, 20001)).toThrow('range')
  })

  it('rejects malformed persisted records and never exposes metadata as provider messages', () => {
    const ledger = new SessionEvidence()
    const snapshot = ledger.snapshot()
    expect(ledger.restore([snapshot])).toEqual([])
    expect(() => ledger.restore([{ ...snapshot, content: '[{"id":"../secret"}]' }])).toThrow('Invalid')
  })

  it('fails closed on duplicate snapshots and clears partial restore state', () => {
    const ledger = new SessionEvidence()
    const first = ledger.add('request', 'user', 'source one')
    const snapshot = ledger.snapshot()
    expect(() => ledger.restore([snapshot, snapshot])).toThrow('Duplicate')
    expect(() => ledger.read(first)).toThrow('Unknown')

    const valid = ledger.snapshot()
    expect(() => ledger.restore([valid, { ...valid, content: '{broken' }])).toThrow()
    expect(() => ledger.read(first)).toThrow('Unknown')
  })

  it('bounds the complete JSON envelope and preserves sources after repeated reads', () => {
    const ledger = new SessionEvidence()
    const id = ledger.add('tool', 'read_file:file.ts', '\u0001'.repeat(25_000))
    let start = 0
    let recovered = ''
    do {
      const raw = ledger.read(id, start, 20_000)
      expect(Buffer.byteLength(raw, 'utf8')).toBeLessThanOrEqual(20_000)
      const part = JSON.parse(raw)
      recovered += part.text
      start = part.next
    } while (start !== null)
    expect(recovered).toBe('\u0001'.repeat(25_000))
    expect(ledger.read(id)).toBe(ledger.read(id))
  })

  it('redacts metadata recovered from persisted snapshots too', () => {
    const ledger = new SessionEvidence()
    const clean = new SessionEvidence()
    const secret = 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456'
    const id = ledger.add('tool', 'read_file:clean', 'payload')
    const snapshot = ledger.snapshot()
    const records = JSON.parse(snapshot.content as string)
    records[0].source = secret
    const restoredSnapshot = { ...snapshot, content: JSON.stringify(records) }
    clean.restore([restoredSnapshot])
    expect(clean.read(id)).not.toContain('abcdefghijklmnopqrstuvwxyz123456')
  })

  it('surfaces verification status and digests as historical, never live, evidence', () => {
    const ledger = new SessionEvidence()
    const id = ledger.add('tool', 'verification', JSON.stringify({ status: 'stale', inputDigest: 'a'.repeat(64), finalDigest: 'b'.repeat(64), output: 'old output' }))
    expect(ledger.context()).toContain(`Historical verification ${id}`)
    expect(ledger.context()).toContain('status=stale')
    expect(ledger.context()).toContain(`input=${'a'.repeat(16)}`)
    expect(ledger.context()).toContain('not proof of current workspace state')
  })

  it('offers read-only recovery in all modes without permitting source mutation', async () => {
    for (const mode of ['plan', 'review', 'build', 'auto'] as const) expect(canUseTool(mode, SessionEvidenceTool.name)).toBe(true)
    await expect(SessionEvidenceTool.execute({})).rejects.toThrow('unavailable')
  })
})

it('keeps a cited refutation authoritative over an earlier hypothesis across restore', () => {
  const ledger = new SessionEvidence()
  const source = ledger.add('tool', 'shell:probe', 'cacheEnabled=false; API_KEY=fake-claim-secret')
  const hypothesis = ledger.recordClaim({ statement: 'The cache causes the failure.', status: 'hypothesis', evidence: [] })
  const refutation = ledger.recordClaim({ statement: 'The cache causes the failure.', status: 'refuted', supersedes: hypothesis, evidence: [{ id: source, excerpt: 'cacheEnabled=false' }] })
  const restored = new SessionEvidence()
  restored.restore([ledger.snapshot()])
  const old = JSON.parse(restored.read(hypothesis))
  expect(old.claimState).toEqual({ currentId: refutation, status: 'refuted', superseded: true })
  expect(restored.context()).toContain(`refuted ${refutation}`)
  expect(restored.context()).not.toContain(`hypothesis ${hypothesis}`)
  expect(restored.context()).toContain('model-authored')
  expect(restored.completionConstraints()).toEqual([])
  expect(restored.completionClaims()).toHaveLength(1)
  expect(restored.completionClaims()[0]?.id).toBe(refutation)
  expect(JSON.parse(restored.read(source)).text).not.toContain('fake-claim-secret')
  expect(() => restored.recordClaim({ statement: 'Old update', status: 'hypothesis', supersedes: hypothesis, evidence: [] })).toThrow('latest')
})

it('rejects invented citations, summary citations and unsupported promotions without changing the ledger', () => {
  const ledger = new SessionEvidence()
  const source = ledger.add('tool', 'read_file:config', 'enabled=false')
  const hypothesis = ledger.recordClaim({ statement: 'Enabled causes failure', status: 'hypothesis', evidence: [] })
  const before = ledger.snapshot()
  const invalid = [
    { statement: 'Confirmed', status: 'supported', evidence: [] },
    { statement: 'Confirmed', status: 'supported', evidence: [{ id: 'missing', excerpt: 'enabled=true' }] },
    { statement: 'Confirmed', status: 'supported', evidence: [{ id: source, excerpt: 'enabled=true' }] },
    { statement: 'Confirmed', status: 'supported', evidence: [{ id: hypothesis, excerpt: 'Enabled' }] },
    { statement: ' ', status: 'hypothesis', evidence: [] },
    { statement: 'x'.repeat(9000), status: 'hypothesis', evidence: [] },
    { statement: 'Confirmed', status: 'fact', evidence: [] },
    { statement: 'Different proposition', status: 'refuted', supersedes: hypothesis, evidence: [{ id: source, excerpt: 'enabled=false' }] },
  ]
  for (const claim of invalid) expect(() => ledger.recordClaim(claim as any)).toThrow()
  expect(ledger.snapshot()).toEqual(before)
})

it('validates claim provenance and revision chains when restoring persisted state', () => {
  const ledger = new SessionEvidence()
  const source = ledger.add('request', 'user', 'Keep the endpoint local.')
  const claim = ledger.recordClaim({ statement: 'The endpoint must stay local.', status: 'supported', evidence: [{ id: source, excerpt: 'endpoint local' }] })
  const snapshot = ledger.snapshot()
  const records = JSON.parse(snapshot.content as string)
  const forged = structuredClone(records)
  forged[1].text = JSON.stringify({ ...JSON.parse(forged[1].text), evidence: [{ id: source, excerpt: 'remote endpoint' }] })
  expect(() => new SessionEvidence().restore([{ ...snapshot, content: JSON.stringify(forged) }])).toThrow('citation')
  const duplicate = structuredClone(records)
  duplicate.push({ ...duplicate[1], id: '00000000-0000-4000-8000-000000000001', text: JSON.stringify({ statement: 'The endpoint must stay local.', status: 'hypothesis', evidence: [], supersedes: claim }) })
  duplicate.push({ ...duplicate[1], id: '00000000-0000-4000-8000-000000000002', text: JSON.stringify({ statement: 'The endpoint must stay local.', status: 'hypothesis', evidence: [], supersedes: claim }) })
  expect(() => new SessionEvidence().restore([{ ...snapshot, content: JSON.stringify(duplicate) }])).toThrow('latest')
  expect(() => new SessionEvidence().restore([{ ...snapshot, content: JSON.stringify(records.reverse()) }])).toThrow('citation')
})


it('redacts claim content and pages omitted claims without letting model notes become requirements', () => {
  const ledger = new SessionEvidence()
  const source = ledger.add('tool', 'read_file:config', 'api_key=fake-claim-canary')
  const supported = ledger.recordClaim({ statement: 'api_key=fake-claim-canary', status: 'supported', evidence: [{ id: source, excerpt: 'api_key=fake-claim-canary' }] })
  for (let index = 0; index < 10; index++) ledger.recordClaim({ statement: `Unverified possibility ${index}`, status: 'hypothesis', evidence: [] })
  expect(ledger.context()).toContain('3 previews omitted')
  expect(JSON.parse(ledger.read()).text).toContain(supported)
  expect(ledger.snapshot().content).not.toContain('fake-claim-canary')
  expect(ledger.read(supported)).not.toContain('fake-claim-canary')
  expect(ledger.completionConstraints()).toEqual([])
  const restored = new SessionEvidence()
  restored.restore([ledger.snapshot()])
  expect(restored.read(supported)).toBe(ledger.read(supported))
  const long = ledger.recordClaim({ statement: '😀'.repeat(1500), status: 'hypothesis', evidence: [] })
  let start: number | null = 0
  let text = ''
  do {
    const raw = ledger.read(long, start, 19999)
    expect(Buffer.byteLength(raw)).toBeLessThanOrEqual(20_000)
    const page = JSON.parse(raw)
    text += page.text
    start = page.next
  } while (start !== null)
  expect(JSON.parse(text).statement).toBe('😀'.repeat(1500))
})

it('refuses complete claim review when all current claims cannot fit, without dropping them', () => {
  const ledger = new SessionEvidence()
  for (let index = 0; index < 8; index++) ledger.recordClaim({ statement: `${index}:` + 'x'.repeat(6000), status: 'hypothesis', evidence: [] })
  expect(() => ledger.completionClaims()).toThrow('claim coverage cannot be verified')
  expect(ledger.context()).toContain('8 current model-authored claims')
})

it('resolves transitive claim revisions without changing prior source text', () => {
  const ledger = new SessionEvidence()
  const statement = 'The cache is enabled.'
  const first = ledger.recordClaim({ statement, status: 'hypothesis', evidence: [] })
  const disabled = ledger.add('tool', 'read_file:before', 'cacheEnabled=false')
  const second = ledger.recordClaim({ statement, status: 'refuted', supersedes: first, evidence: [{ id: disabled, excerpt: 'cacheEnabled=false' }] })
  const enabled = ledger.add('tool', 'read_file:after', 'cacheEnabled=true')
  const third = ledger.recordClaim({ statement, status: 'supported', supersedes: second, evidence: [{ id: enabled, excerpt: 'cacheEnabled=true' }] })
  const restored = new SessionEvidence()
  restored.restore([ledger.snapshot()])
  for (const id of [first, second]) expect(JSON.parse(restored.read(id)).claimState).toEqual({ currentId: third, status: 'supported', superseded: true })
  expect(JSON.parse(restored.read(second)).text).toContain('"status":"refuted"')
  expect(JSON.parse(restored.read(disabled)).text).toBe('cacheEnabled=false')
  expect(restored.completionClaims()).toEqual([{ id: third, claim: { statement, status: 'supported', supersedes: second, evidence: [{ id: enabled, excerpt: 'cacheEnabled=true' }] } }])
})
