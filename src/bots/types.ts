import type { MessageOrBoundary } from '../agent/compactBoundary.js'
import type { Goal } from '../agent/goal.js'
import type { TodoItem } from '../agent/todoStore.js'
import type { RecordedStep } from '../browser/record.js'

export interface ProcedureStep extends RecordedStep { pageUrl?: string; input?: string; urlFragment?: boolean }
export interface BotProcedure {
  id: string; botId: string; name: string; sourceRunId: string; steps: ProcedureStep[]
  status: 'ready' | 'needs_review'; createdAt: string
}

export interface BotRuntimeState { goal: Goal | null; todos: TodoItem[] }

export const POD_APPEARANCE_OPTIONS = {
  shape: ['cloud', 'circle', 'square', 'clover', 'star', 'heart', 'diamond', 'capsule', 'pear', 'bean', 'droplet', 'triangle', 'flower'],
  tone: ['blue', 'violet', 'teal', 'amber', 'rose', 'coral', 'mint', 'cream', 'lilac', 'graphite', 'orange', 'red'],
  eyes: ['round', 'curious', 'happy'],
  accessory: ['none', 'glasses', 'headphones', 'cap', 'sunglasses', 'bowtie', 'scarf', 'bucket-hat', 'antenna', 'crown'],
} as const
export type PodAppearance = { [K in keyof typeof POD_APPEARANCE_OPTIONS]: typeof POD_APPEARANCE_OPTIONS[K][number] }
export const POD_TONE_COLORS: Record<PodAppearance['tone'], string> = {
  blue: '#70acec', violet: '#ab83dc', teal: '#73cbaa', amber: '#f0bd53', rose: '#e98ba9',
  coral: '#ed927b', mint: '#b7d9b2', cream: '#e8d9b6', lilac: '#c6b7e3', graphite: '#737a88', orange: '#eaa15b', red: '#c96565',
}

export interface Bot {
  id: string
  name: string
  projectRoot: string
  instructions: string
  agentConfig?: string
  /** Optional model used for mandatory goal-completion review; absent means the pod's active model. */
  reviewerModel?: string
  appearance?: PodAppearance
  enabled: boolean
  deleting: boolean
  retentionDays: number | null
  createdAt: string
  updatedAt: string
}

export type RunStatus = 'queued' | 'running' | 'waiting' | 'blocked' | 'completed' | 'failed' | 'cancelled'
export interface BotRun {
  id: string
  botId: string
  prompt: string
  source: string
  occurrenceId: string
  status: RunStatus
  attempt: number
  owner: string | null
  leaseUntil: number | null
  output: string
  error: string | null
  createdAt: string
  updatedAt: string
  procedureId: string | null
  procedureInputs: Record<string, string>
  procedureCursor: number
  browserStepCount: number
  steeringCursor: number
  acceptingMessages: boolean
  /** Safe routine preview: all non-local-read tools are recorded, never executed. */
  testMode: boolean
  retentionPending: boolean
  /** Parent occurrence that requested this work through bot_control.send. */
  parentRunId: string | null
  /** Caller-supplied idempotency key for the parent-to-child handoff. */
  handoffMessageId: string | null
  /** Collaboration room, if this occurrence was launched from a group message. */
  groupId: string | null
  groupMessageId: string | null
}

export interface BotRunMessage { id: string; runId: string; sequence: number; content: string; createdAt: string }

export interface BotNote {
  id: string
  botId: string
  content: string
  source: string
  expiresAt: number | null
  createdAt: string
  updatedAt: string
  version: number
}

export type DecisionKind = 'permission' | 'question' | 'reconciliation'
export interface BotDecision {
  id: string
  botId: string
  runId: string
  kind: DecisionKind
  request: Record<string, unknown>
  fingerprint: string
  status: 'pending' | 'answered' | 'consumed' | 'cancelled'
  answer: unknown
  createdAt: string
}

export type Schedule =
  | { kind: 'once'; at: number }
  | { kind: 'interval'; everyMs: number; endsAt?: number }
  | { kind: 'daily'; hour: number; minute: number; timeZone: string; weekdays?: number[]; endsAt?: number }
  | { kind: 'event'; topic: string; endsAt?: number }

export interface BotRoutine {
  id: string
  botId: string
  version: number
  name: string
  prompt: string
  schedule: Schedule
  nextAt: number | null
  enabled: boolean
  createdAt: string
  procedureId: string | null
  procedureInputs: Record<string, string>
}

export interface BotConversation {
  transcript: MessageOrBoundary[]
  legacyTranscript: MessageOrBoundary[]
  runs: BotRun[]
  decisions: BotDecision[]
  notes: BotNote[]
  routines: BotRoutine[]
  procedures: BotProcedure[]
  guidance: BotRunMessage[]
}

export type BotDeliveryTopic = 'run.completed' | 'run.failed' | 'run.blocked'
export interface BotDeliveryTarget {
  id: string
  botId: string
  url: string
  topics: BotDeliveryTopic[]
  publicKey: string
  enabled: boolean
  createdAt: string
}
export interface BotDeliveryRecord {
  id: string
  botId: string
  targetId: string
  eventId: string
  eventType: BotDeliveryTopic
  body: string
  status: 'queued' | 'sending' | 'delivered' | 'failed'
  attempt: number
  nextAt: number
  leaseUntil: number | null
  responseStatus: number | null
  lastError: string | null
  createdAt: string
  deliveredAt: string | null
}
export interface BotDeliveryJob {
  record: BotDeliveryRecord
  target: BotDeliveryTarget
}

export interface BotGroup {
  id: string
  name: string
  shareBrowser: boolean
  deleting: boolean
  createdAt: string
  updatedAt: string
  members: Array<{ botId: string; name: string; enabled: boolean }>
}
export interface BotGroupMessage {
  id: string
  groupId: string
  sequence: number
  sender: 'user' | 'bot'
  botId: string | null
  runId: string | null
  content: string
  createdAt: string
}
export interface BotGroupArtifact {
  groupId: string
  name: string
  content?: string
  version: number
  updatedByBotId: string | null
  updatedByRunId: string | null
  updatedAt: string
}
