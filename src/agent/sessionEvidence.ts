import { createHash, randomUUID } from 'node:crypto'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import { redactSecrets } from '../orchestration/events.js'
import { isBoundaryMarker, type MessageOrBoundary } from './compactBoundary.js'

const MARKER = 'deepseek_runtime_evidence_v1'
const MAX_READ_ENVELOPE_CHARS = 20_000
const MAX_SOURCE_CHARS = 512
const MAX_PENDING_TOOL_REPLAYS = 128
const PENDING_REPLAY_SOURCE = 'pending-tool-replay'
const PENDING_REPLAY_OVERFLOW_SOURCE = 'pending-tool-replay-overflow'
export interface EvidenceEntry { id: string; kind: 'request' | 'denial' | 'tool' | 'claim' | 'grant' | 'authorization' | 'pending_replay'; source: string; text: string }
export interface PendingToolReplay { toolName: string; argsDigest: string }
export interface SessionGrantEvent {
  grantId: string
  status: 'active' | 'revoked' | 'expired'
  scope: 'tool' | 'directory'
  subject: string
  at: string
  reason: 'user-session-approval' | 'user-directory-approval' | 'explicit-clear' | 'directory-removed' | 'workspace-changed' | 'agent-changed' | 'settings-changed' | 'session-resumed'
}
export interface AuthorizationDecisionEvent {
  actor: 'user' | 'permission-hook'
  decision: 'allow' | 'deny' | 'reject' | 'block'
  scope: 'call' | 'persistent-policy'
  reason: 'outside_workspace' | 'risk' | 'permission' | 'agent_config' | 'workflow' | 'interrupted_replay'
  subjectHash: string
  toolName: string
  toolCallId?: string
  at: string
}

function validUnicode(value: string): string {
  let result = ''
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (next >= 0xdc00 && next <= 0xdfff) result += value[index]! + value[++index]!
      else result += '\ufffd'
    } else if (code >= 0xdc00 && code <= 0xdfff) result += '\ufffd'
    else result += value[index]!
  }
  return result
}

function redactedText(value: string): string {
  const normalized = validUnicode(value)
  const structured = normalized.replace(
    /("(?:api[_-]?key|authorization|cookie|credential|password|private[_-]?key|secret|(?:access|auth|refresh|session)?token)"\s*:\s*")(?:[^"\\]|\\.)*(")/gi,
    '$1[REDACTED]$2',
  )
  return validUnicode(redactSecrets(structured) as string)
}

function normalizeReplayArgs(value: unknown): unknown {
  if (typeof value === 'string') return validUnicode(value).normalize('NFC')
  if (Array.isArray(value)) return value.map(normalizeReplayArgs)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, normalizeReplayArgs((value as Record<string, unknown>)[key])]))
  }
  return value
}

/** Stable digest for parsed tool arguments; raw arguments are never added to the replay ledger. */
export function toolReplayArgsDigest(args: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(normalizeReplayArgs(redactSecrets(args)))).digest('hex')
}

function safeSource(source: string): string {
  const redacted = redactedText(source)
  if (redacted.length <= MAX_SOURCE_CHARS) return redacted
  let end = MAX_SOURCE_CHARS - 1
  if (end > 0 && /[\uD800-\uDBFF]/.test(redacted[end - 1]!)) end--
  return `${redacted.slice(0, end)}…`
}

function isEvidenceEntry(value: unknown): value is EvidenceEntry {
  if (!value || typeof value !== 'object') return false
  const keys = Object.keys(value)
  if (keys.length !== 4 || !['id', 'kind', 'source', 'text'].every(key => keys.includes(key))) return false
  const entry = value as Partial<EvidenceEntry>
  return typeof entry.id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(entry.id) &&
    (entry.kind === 'request' || entry.kind === 'denial' || entry.kind === 'tool' || entry.kind === 'claim' || entry.kind === 'grant' || entry.kind === 'authorization' || entry.kind === 'pending_replay') &&
    typeof entry.source === 'string' && typeof entry.text === 'string'
}

function validatePendingToolReplay(value: unknown): PendingToolReplay {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 2) throw new Error('Invalid pending tool replay')
  const replay = value as PendingToolReplay
  if (typeof replay.toolName !== 'string' || !/^[A-Za-z0-9_.-]{1,128}$/.test(replay.toolName) ||
    typeof replay.argsDigest !== 'string' || !/^[a-f0-9]{64}$/.test(replay.argsDigest)) throw new Error('Invalid pending tool replay fields')
  return replay
}

function validateGrantEvent(value: unknown): SessionGrantEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid session grant event')
  const event = value as SessionGrantEvent
  if (Object.keys(value).length !== 6 ||
    typeof event.grantId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(event.grantId) ||
    !['active', 'revoked', 'expired'].includes(event.status) ||
    !['tool', 'directory'].includes(event.scope) ||
    typeof event.subject !== 'string' || !event.subject.trim() || event.subject.length > 8_192 || event.subject.includes('\0') ||
    typeof event.at !== 'string' || Number.isNaN(Date.parse(event.at)) || new Date(event.at).toISOString() !== event.at ||
    !['user-session-approval', 'user-directory-approval', 'explicit-clear', 'directory-removed', 'workspace-changed', 'agent-changed', 'settings-changed', 'session-resumed'].includes(event.reason)) {
    throw new Error('Invalid session grant event fields')
  }
  if (event.status === 'active' && event.reason !== (event.scope === 'tool' ? 'user-session-approval' : 'user-directory-approval')) {
    throw new Error('Invalid session grant creation reason')
  }
  if (event.status !== 'active' && ['user-session-approval', 'user-directory-approval'].includes(event.reason)) {
    throw new Error('Invalid session grant closure reason')
  }
  if (event.status === 'expired' && !['workspace-changed', 'agent-changed', 'session-resumed'].includes(event.reason)) throw new Error('Invalid session grant expiration reason')
  if (event.status === 'revoked' && !['explicit-clear', 'directory-removed', 'workspace-changed', 'agent-changed', 'settings-changed'].includes(event.reason)) throw new Error('Invalid session grant revocation reason')
  return { ...event, subject: redactedText(event.subject) }
}

function validateAuthorizationDecision(value: unknown): AuthorizationDecisionEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid authorization decision event')
  const event = value as AuthorizationDecisionEvent
  const hasToolCallId = Object.hasOwn(value, 'toolCallId')
  if (Object.keys(value).length !== (hasToolCallId ? 8 : 7) ||
    !['user', 'permission-hook'].includes(event.actor) ||
    !['allow', 'deny', 'reject', 'block'].includes(event.decision) ||
    !['call', 'persistent-policy'].includes(event.scope) ||
    !['outside_workspace', 'risk', 'permission', 'agent_config', 'workflow', 'interrupted_replay'].includes(event.reason) ||
    typeof event.subjectHash !== 'string' || !/^[a-f0-9]{64}$/.test(event.subjectHash) ||
    typeof event.toolName !== 'string' || !event.toolName.trim() || event.toolName.length > 256 || event.toolName.includes('\0') ||
    (hasToolCallId && (typeof event.toolCallId !== 'string' || !event.toolCallId.trim() || event.toolCallId.length > 256 || event.toolCallId.includes('\0'))) ||
    typeof event.at !== 'string' || Number.isNaN(Date.parse(event.at)) || new Date(event.at).toISOString() !== event.at) {
    throw new Error('Invalid authorization decision event fields')
  }
  if (event.scope === 'persistent-policy' && (event.actor !== 'user' || event.decision !== 'allow')) throw new Error('Invalid persistent policy decision')
  if (event.actor === 'permission-hook' && !['allow', 'block'].includes(event.decision)) throw new Error('Invalid permission hook decision')
  if (event.actor === 'user' && event.decision === 'block') throw new Error('Invalid user decision')
  return event
}

export interface SessionClaim {
  statement: string
  status: 'hypothesis' | 'supported' | 'refuted'
  evidence: Array<{ id: string; excerpt: string }>
  supersedes?: string
}

function validateClaim(value: unknown, entries: EvidenceEntry[]): SessionClaim {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid claim')
  const claim = value as SessionClaim
  if (Object.keys(value).some(key => !['statement', 'status', 'evidence', 'supersedes'].includes(key)) ||
    typeof claim.statement !== 'string' || !claim.statement.trim() ||
    !['hypothesis', 'supported', 'refuted'].includes(claim.status) ||
    !Array.isArray(claim.evidence) || claim.evidence.length > 8 ||
    (claim.supersedes !== undefined && typeof claim.supersedes !== 'string')) throw new Error('Invalid claim fields')
  const statement = redactedText(claim.statement).trim()
  const evidence = claim.evidence.map(citation => {
    if (!citation || typeof citation !== 'object' || Object.keys(citation).length !== 2 ||
      typeof citation.id !== 'string' || typeof citation.excerpt !== 'string' || !citation.excerpt.trim()) throw new Error('Invalid claim citation')
    const excerpt = redactedText(citation.excerpt)
    const source = entries.find(entry => entry.id === citation.id)
    if (!source || source.kind === 'claim' || !source.text.includes(excerpt)) throw new Error('Claim citation must match an original request, denial, or tool source; summaries and other claims are not evidence')
    return { id: citation.id, excerpt }
  })
  if (claim.status !== 'hypothesis' && !evidence.length) throw new Error('Supported/refuted claims require source citations')
  if (claim.supersedes !== undefined) {
    const previous = entries.find(entry => entry.id === claim.supersedes)
    if (!previous || previous.kind !== 'claim' || entries.some(entry => entry.kind === 'claim' && JSON.parse(entry.text).supersedes === previous.id)) throw new Error('Claim revision must supersede the latest existing claim revision')
    if ((JSON.parse(previous.text) as SessionClaim).statement !== statement) throw new Error('Claim revisions must preserve the original statement; record a different proposition separately')
  }
  const normalized: SessionClaim = { statement, status: claim.status, evidence, ...(claim.supersedes !== undefined ? { supersedes: claim.supersedes } : {}) }
  if (Buffer.byteLength(JSON.stringify(normalized), 'utf8') > 8_000) throw new Error('Claim exceeds the 8000-byte record budget')
  return normalized
}

/** Runtime-owned source records; summaries never edit or replace them. */
export class SessionEvidence {
  private entries: EvidenceEntry[] = []

  add(kind: Exclude<EvidenceEntry['kind'], 'claim' | 'grant'>, source: string, text: string): string {
    const id = randomUUID()
    this.entries.push({ id, kind, source: safeSource(source), text: redactedText(text) })
    return id
  }

  /** Records a session-only approval for audit; this ledger never authorizes tool execution. */
  recordSessionGrant(scope: SessionGrantEvent['scope'], subject: string): string {
    const safeSubject = redactedText(subject)
    const existing = this.activeSessionGrants().find(grant => grant.scope === scope && grant.subject === safeSubject)
    if (existing) return existing.grantId
    const reason = scope === 'tool' ? 'user-session-approval' : 'user-directory-approval'
    const grantId = randomUUID()
    this.appendGrantEvent({ grantId, status: 'active', scope, subject: safeSubject, at: new Date().toISOString(), reason })
    return grantId
  }

  /** Ends matching current-session grants without changing the runtime's permission checks. */
  endSessionGrants(
    status: Extract<SessionGrantEvent['status'], 'revoked' | 'expired'>,
    reason: Extract<SessionGrantEvent['reason'], 'explicit-clear' | 'directory-removed' | 'workspace-changed' | 'agent-changed' | 'settings-changed' | 'session-resumed'>,
    scope?: SessionGrantEvent['scope'],
    subject?: string,
  ): number {
    let ended = 0
    for (const grant of this.activeSessionGrants()) {
      if ((scope && grant.scope !== scope) || (subject !== undefined && grant.subject !== subject)) continue
      this.appendGrantEvent({ ...grant, status, at: new Date().toISOString(), reason })
      ended++
    }
    return ended
  }

  activeSessionGrants(): SessionGrantEvent[] {
    const latest = new Map<string, SessionGrantEvent>()
    for (const entry of this.entries) {
      if (entry.kind !== 'grant') continue
      const event = JSON.parse(entry.text) as SessionGrantEvent
      latest.set(event.grantId, event)
    }
    return [...latest.values()].filter(event => event.status === 'active').map(event => ({ ...event }))
  }

  private appendGrantEvent(event: SessionGrantEvent): void {
    const validated = validateGrantEvent(event)
    this.entries.push({ id: randomUUID(), kind: 'grant', source: 'session-grant', text: JSON.stringify(validated) })
  }

  /** Records an exact user/hook decision without persisting the tool arguments. */
  recordAuthorizationDecision(event: Omit<AuthorizationDecisionEvent, 'at'>): string {
    const validated = validateAuthorizationDecision({ ...event, at: new Date().toISOString() })
    const id = randomUUID()
    this.entries.push({ id, kind: 'authorization', source: 'authorization-decision', text: JSON.stringify(validated) })
    return id
  }

  /** Retains only a tool name and redacted-argument digest for an interrupted call. */
  recordPendingToolReplay(toolName: string, args: Record<string, unknown>): PendingToolReplay {
    if (!/^[A-Za-z0-9_.-]{1,128}$/.test(toolName)) throw new Error('Invalid pending tool replay name')
    return this.ensurePendingToolReplay({ toolName, argsDigest: toolReplayArgsDigest(args) })
  }

  /** Reinstates a guard when saving the result that would clear it fails. */
  ensurePendingToolReplay(value: PendingToolReplay): PendingToolReplay {
    const replay = validatePendingToolReplay(value)
    const existing = this.pendingToolReplayRecords()
    if (existing.some(entry => entry.toolName === replay.toolName && entry.argsDigest === replay.argsDigest)) return replay
    if (existing.length >= MAX_PENDING_TOOL_REPLAYS) {
      if (!this.entries.some(entry => entry.kind === 'pending_replay' && entry.source === PENDING_REPLAY_OVERFLOW_SOURCE)) {
        this.entries.push({ id: randomUUID(), kind: 'pending_replay', source: PENDING_REPLAY_OVERFLOW_SOURCE, text: '{"overflow":true}' })
      }
      return replay
    }
    this.entries.push({ id: randomUUID(), kind: 'pending_replay', source: PENDING_REPLAY_SOURCE, text: JSON.stringify(replay) })
    return replay
  }

  pendingToolReplayRecords(): PendingToolReplay[] {
    return this.entries.filter(entry => entry.kind === 'pending_replay' && entry.source === PENDING_REPLAY_SOURCE)
      .map(entry => validatePendingToolReplay(JSON.parse(entry.text)))
  }

  hasPendingToolReplay(toolName: string, argsDigest: string): boolean {
    return this.entries.some(entry => entry.kind === 'pending_replay' && entry.source === PENDING_REPLAY_OVERFLOW_SOURCE) ||
      this.pendingToolReplayRecords().some(entry => entry.toolName === toolName && entry.argsDigest === argsDigest)
  }

  resolvePendingToolReplay(replay: PendingToolReplay): boolean {
    const index = this.entries.findIndex(entry => {
      if (entry.kind !== 'pending_replay' || entry.source !== PENDING_REPLAY_SOURCE) return false
      const value = validatePendingToolReplay(JSON.parse(entry.text))
      return value.toolName === replay.toolName && value.argsDigest === replay.argsDigest
    })
    if (index < 0) return false
    this.entries.splice(index, 1)
    return true
  }

  recordClaim(claim: SessionClaim): string {
    const normalized = validateClaim(claim, this.entries)
    const id = randomUUID()
    this.entries.push({ id, kind: 'claim', source: 'model-claim', text: JSON.stringify(normalized) })
    return id
  }

  private currentClaims(): EvidenceEntry[] {
    const claims = this.entries.filter(entry => entry.kind === 'claim')
    const superseded = new Set(claims.map(entry => (JSON.parse(entry.text) as SessionClaim).supersedes))
    return claims.filter(entry => !superseded.has(entry.id))
  }

  toolSources(): EvidenceEntry[] {
    return this.entries.filter(entry => entry.kind === 'tool').map(entry => ({ ...entry }))
  }

  completionClaims(): Array<{ id: string; claim: SessionClaim }> {
    const claims = this.currentClaims().map(entry => ({ id: entry.id, claim: JSON.parse(entry.text) as SessionClaim }))
    if (Buffer.byteLength(JSON.stringify(claims), 'utf8') > 40_000) throw new Error('Full claim state exceeds the completion review budget; claim coverage cannot be verified')
    return claims
  }

  private claimStates(): Map<string, { currentId: string; status: SessionClaim['status']; superseded: boolean }> {
    const states = new Map<string, { currentId: string; status: SessionClaim['status']; superseded: boolean }>()
    for (let index = this.entries.length - 1; index >= 0; index--) {
      const entry = this.entries[index]!
      if (entry.kind !== 'claim') continue
      const claim = JSON.parse(entry.text) as SessionClaim
      const state = states.get(entry.id) ?? { currentId: entry.id, status: claim.status, superseded: false }
      states.set(entry.id, state)
      if (claim.supersedes) states.set(claim.supersedes, { ...state, superseded: true })
    }
    return states
  }

  snapshot(): ChatCompletionMessageParam {
    return { role: 'system', name: MARKER, content: JSON.stringify(this.entries) }
  }

  latest(source: string): EvidenceEntry | undefined {
    const entry = [...this.entries].reverse().find(item => item.source === source)
    return entry ? { ...entry } : undefined
  }

  /** Complete redacted constraint sources for the independent completion review, never a partial preview. */
  completionConstraints(): EvidenceEntry[] {
    const constraints = this.entries.filter(entry => entry.kind === 'request' || entry.kind === 'denial').map(entry => ({ ...entry }))
    // shortcut: one review request; use paginated requirement reviews if source constraints exceed 40KB.
    if (Buffer.byteLength(JSON.stringify(constraints), 'utf8') > 40_000) {
      throw new Error('Original request/denial sources exceed the completion review budget; full requirement coverage cannot be verified in one request')
    }
    return constraints
  }

  restore(messages: MessageOrBoundary[]): MessageOrBoundary[] {
    this.entries = []
    const restored: EvidenceEntry[] = []
    const ids = new Set<string>()
    const grantStates = new Map<string, SessionGrantEvent>()
    const pendingReplayKeys = new Set<string>()
    let pendingReplayCount = 0
    let hasPendingReplayOverflow = false
    try {
      const ordinary = messages.filter(message => {
        if (isBoundaryMarker(message) || message.role !== 'system' || message.name !== MARKER) return true
        if (typeof message.content !== 'string') throw new Error('Invalid session evidence snapshot')
        const entries: unknown = JSON.parse(message.content)
        if (!Array.isArray(entries) || !entries.every(isEvidenceEntry)) throw new Error('Invalid session evidence entries')
        for (const entry of entries) {
          if (ids.has(entry.id)) throw new Error('Duplicate session evidence id')
          ids.add(entry.id)
          if (entry.kind === 'claim') {
            if (entry.source !== 'model-claim') throw new Error('Invalid claim origin')
            const claim = validateClaim(JSON.parse(entry.text), restored)
            restored.push({ id: entry.id, kind: 'claim', source: 'model-claim', text: JSON.stringify(claim) })
          } else if (entry.kind === 'grant') {
            if (entry.source !== 'session-grant') throw new Error('Invalid grant origin')
            const event = validateGrantEvent(JSON.parse(entry.text))
            const previous = grantStates.get(event.grantId)
            if ((!previous && event.status !== 'active') || (previous && (previous.status !== 'active' || event.status === 'active' || previous.scope !== event.scope || previous.subject !== event.subject))) {
              throw new Error('Invalid session grant lifecycle')
            }
            grantStates.set(event.grantId, event)
            restored.push({ id: entry.id, kind: 'grant', source: 'session-grant', text: JSON.stringify(event) })
          } else if (entry.kind === 'authorization') {
            if (entry.source !== 'authorization-decision') throw new Error('Invalid authorization decision origin')
            const event = validateAuthorizationDecision(JSON.parse(entry.text))
            restored.push({ id: entry.id, kind: 'authorization', source: 'authorization-decision', text: JSON.stringify(event) })
          } else if (entry.kind === 'pending_replay') {
            if (entry.source === PENDING_REPLAY_OVERFLOW_SOURCE) {
              if (hasPendingReplayOverflow || entry.text !== '{"overflow":true}') throw new Error('Invalid pending tool replay overflow marker')
              hasPendingReplayOverflow = true
              restored.push({ ...entry })
            } else {
              if (entry.source !== PENDING_REPLAY_SOURCE) throw new Error('Invalid pending tool replay origin')
              const replay = validatePendingToolReplay(JSON.parse(entry.text))
              const key = `${replay.toolName}:${replay.argsDigest}`
              if (pendingReplayKeys.has(key)) throw new Error('Duplicate pending tool replay')
              pendingReplayKeys.add(key)
              if (++pendingReplayCount > MAX_PENDING_TOOL_REPLAYS) throw new Error('Too many pending tool replays')
              restored.push({ id: entry.id, kind: 'pending_replay', source: PENDING_REPLAY_SOURCE, text: JSON.stringify(replay) })
            }
          } else restored.push({ id: entry.id, kind: entry.kind, source: safeSource(entry.source), text: redactedText(entry.text) })
        }
        return false
      })
      this.entries = restored
      this.endSessionGrants('expired', 'session-resumed')
      return ordinary
    } catch (error) {
      // A partially valid snapshot must never replace the current source ledger.
      this.entries = []
      throw error
    }
  }

  context(includeFirstRequestPreview = true): string {
    const constraints = this.entries.filter(entry => entry.kind === 'request' || entry.kind === 'denial')
    const latest = constraints.slice(-8)
    const originalObjective = constraints.find(entry => entry.kind === 'request')
    const objectivePreview = includeFirstRequestPreview && originalObjective && !latest.some(entry => entry.id === originalObjective.id) ? originalObjective : undefined
    const omittedConstraintPreviews = constraints.length - latest.length - Number(!!objectivePreview)
    const claims = this.currentClaims()
    const tools = this.entries.filter(entry => entry.kind === 'tool')
    const grants = this.entries.filter(entry => entry.kind === 'grant')
    const decisions = this.entries.filter(entry => entry.kind === 'authorization')
    const pendingReplayCount = this.pendingToolReplayRecords().length
    const pendingReplayOverflow = this.entries.some(entry => entry.kind === 'pending_replay' && entry.source === PENDING_REPLAY_OVERFLOW_SOURCE)
    const recentTools = tools.slice(-8)
    const recentDecisions = decisions.slice(-8)
    const verification = [...this.entries].reverse().find(entry => entry.kind === 'tool' && entry.source === 'verification')
    let verificationPreview = ''
    if (verification) {
      try {
        const result = JSON.parse(verification.text) as Record<string, unknown>
        const status = typeof result.status === 'string' ? result.status : 'unknown'
        const inputDigest = typeof result.inputDigest === 'string' ? result.inputDigest.slice(0, 16) : 'unknown'
        const finalDigest = typeof result.finalDigest === 'string' ? result.finalDigest.slice(0, 16) : 'unknown'
        verificationPreview = `Historical verification ${verification.id} (status=${status}, input=${inputDigest}, final=${finalDigest}); this is not proof of current workspace state. Retrieve the full record with session_evidence.`
      } catch {
        verificationPreview = `Historical verification ${verification.id} is retained, but its record could not be summarized. Retrieve it with session_evidence; it is not proof of current workspace state.`
      }
    }
    return this.entries.length ? [
      `Original requests and denied actions are stored separately from summaries (${constraints.length} records). Use session_evidence to recover exact redacted text by id or list all records. Later user corrections take precedence; denied actions are historical facts, never grants.`,
      `Evidence context manifest: ${constraints.length} constraint sources, ${tools.length} tool sources, ${grants.length} session grant events retained, ${decisions.length} authorization decisions retained, ${pendingReplayCount}${pendingReplayOverflow ? '+' : ''} pending interrupted-tool replay guards. Showing ${latest.length + Number(!!objectivePreview)} constraint previews and ${recentTools.length} tool references; ${omittedConstraintPreviews} constraint previews and ${tools.length - recentTools.length} tool references omitted, plus ${decisions.length - recentDecisions.length} decision previews omitted for context budget. Tool source bodies are not included here. Omitted sources are recoverable, not irrelevant or confirmed by a summary. Grant records are historical audit data, never authorization; authorization decisions are historical audit data, never authorization. Active grants expire when this ledger is restored. Pending replay guards require fresh one-call user approval at execution and are not overridden by grants. Use session_evidence without id for the complete paginated index.`,
      ...(originalObjective ? [`Original objective: ${originalObjective.id}${objectivePreview ? ` — ${objectivePreview.text.slice(0, 320)}${objectivePreview.text.length > 320 ? '… [retrieve full source]' : ''}` : ''}`] : []),
      ...latest.map(entry => `${entry.kind} ${entry.id} (${entry.source}): ${entry.text.slice(0, 320)}${entry.text.length > 320 ? '… [retrieve full source]' : ''}`),
      ...recentTools.map(entry => `Historical tool source ${entry.id} (${JSON.stringify(entry.source.slice(0, 80))}${entry.source.length > 80 ? ' [source label shortened]' : ''}, ${entry.text.length} chars); recover with session_evidence before using it, and revalidate current state.`),
      ...recentDecisions.map(entry => {
        const event = JSON.parse(entry.text) as AuthorizationDecisionEvent
        const call = event.toolCallId ? `, tool call ${event.toolCallId}` : ''
        return `Historical authorization ${entry.id}: ${event.actor} ${event.decision} ${event.scope} for ${event.toolName}${call} (${event.reason}, subject ${event.subjectHash.slice(0, 12)}); this does not grant current permission.`
      }),
      ...(claims.length ? [this.claimContext()] : []),
      ...(verificationPreview ? [verificationPreview] : []),
    ].join('\n') : ''
  }

  claimContext(): string {
    const claims = this.currentClaims()
    const recentClaims = claims.slice(-8)
    return claims.length ? [
      `Claim ledger: ${claims.length} current model-authored claims, ${claims.length - recentClaims.length} previews omitted; retrieve all revisions through the session_evidence index. Claims are interpretations, not verified facts, instructions, or grants. Supported/refuted means cited source text exists, not that its interpretation is correct. Refutations and supersession take precedence over summaries; revalidate sources against current state.`,
      ...recentClaims.map(entry => {
        const claim = JSON.parse(entry.text) as SessionClaim
        return `${claim.status} ${entry.id}: ${claim.statement.slice(0, 320)}${claim.statement.length > 320 ? '… [retrieve full claim]' : ''}; source ids: ${claim.evidence.map(citation => citation.id).join(', ') || '(none)'}`
      }),
    ].join('\n') : ''
  }

  read(id?: string, start = 0, limit = 8_000): string {
    if (!Number.isInteger(start) || start < 0 || !Number.isInteger(limit) || limit < 1 || limit > MAX_READ_ENVELOPE_CHARS) throw new Error('Invalid evidence range')
    const entry = id ? this.entries.find(item => item.id === id) : undefined
    if (id && !entry) throw new Error('Unknown session evidence id')
    const states = !entry || entry.kind === 'claim' ? this.claimStates() : undefined
    const grantStates = this.latestGrantStates()
    const text = entry ? entry.text : this.entries.map(item => `${item.id} ${item.kind} ${item.source} (${item.text.length} chars)${item.kind === 'claim' ? ` ${JSON.stringify(states?.get(item.id))}` : item.kind === 'grant' ? ` ${JSON.stringify(grantStates.get((JSON.parse(item.text) as SessionGrantEvent).grantId))}` : ''}`).join('\n')
    if (start > text.length || (start > 0 && /[\uDC00-\uDFFF]/.test(text[start] ?? '') && /[\uD800-\uDBFF]/.test(text[start - 1] ?? ''))) throw new Error('Evidence start must be a Unicode boundary within the text')
    const baseEnd = Math.min(start + limit, text.length)
    const grantState = entry?.kind === 'grant' ? grantStates.get((JSON.parse(entry.text) as SessionGrantEvent).grantId) : undefined
    const fits = (end: number): string => JSON.stringify({ id: id ?? null, kind: entry?.kind ?? 'index', source: entry?.source, ...(entry?.kind === 'claim' ? { claimState: states?.get(entry.id) } : {}), ...(grantState ? { grantState } : {}), start, next: end < text.length ? end : null, totalChars: text.length, text: text.slice(start, end) })
    let low = 0, high = baseEnd - start, end = start
    while (low <= high) {
      const middle = Math.floor((low + high) / 2)
      let candidate = start + middle
      if (candidate < text.length && /[\uD800-\uDBFF]/.test(text[candidate - 1] ?? '')) candidate--
      if (Buffer.byteLength(fits(candidate), 'utf8') <= MAX_READ_ENVELOPE_CHARS) {
        end = candidate
        low = middle + 1
      } else high = middle - 1
    }
    if (end === start && start < text.length) throw new Error('Evidence envelope has insufficient room for the next Unicode character')
    const result = fits(end)
    if (Buffer.byteLength(result, 'utf8') > MAX_READ_ENVELOPE_CHARS) throw new Error('Evidence metadata exceeds the response envelope limit')
    return result
  }

  private latestGrantStates(): Map<string, SessionGrantEvent> {
    const latest = new Map<string, SessionGrantEvent>()
    for (const entry of this.entries) {
      if (entry.kind !== 'grant') continue
      latest.set((JSON.parse(entry.text) as SessionGrantEvent).grantId, JSON.parse(entry.text) as SessionGrantEvent)
    }
    return latest
  }
}
