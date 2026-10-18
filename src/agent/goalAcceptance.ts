import { isDeepStrictEqual } from 'node:util'
import { isPassedVerificationForWorkspace } from './verify.js'
import { validateSchema } from '../orchestration/schema.js'
import type { EvidenceEntry } from './sessionEvidence.js'

export interface AcceptanceSource { id: string; text: string }
export interface AcceptanceCriterion {
  id: string
  text: string
  source_id: string
  quote: string
  verification: 'test' | 'inspection' | 'external'
}
export interface GoalCriteria {
  sourceFingerprint: string
  items: AcceptanceCriterion[]
}
export interface CriterionAssessment {
  id: string
  status: 'satisfied' | 'missing' | 'unverified'
  reason: string
  evidence: Array<{ source_id: string; quote: string }>
}
export interface GoalAcceptanceReview {
  complete: boolean
  explicit_completion: boolean
  coverage_complete: boolean
  reason: string
  criteria: CriterionAssessment[]
}

const NON_PROOF_TOOLS = new Set(['get_goal', 'create_goal', 'update_goal', 'todo', 'step', 'introspect', 'discover_tools', 'record_claim', 'session_evidence', 'memory', 'update_knowledge', 'subagent', 'ask_agent', 'moa', 'workflow'])

const text = { type: 'string', minLength: 1, maxLength: 2000 }
const citation = { type: 'object', properties: { source_id: text, quote: text }, required: ['source_id', 'quote'], additionalProperties: false }
const extractionSchema = { type: 'object', properties: { criteria: { type: 'array', minItems: 1, maxItems: 100, items: {
  type: 'object', properties: { text, source_id: text, quote: text, verification: { type: 'string', enum: ['test', 'inspection', 'external'] } },
  required: ['text', 'source_id', 'quote', 'verification'], additionalProperties: false,
} } }, required: ['criteria'], additionalProperties: false }
const reviewSchema = { type: 'object', properties: {
  complete: { type: 'boolean' }, explicit_completion: { type: 'boolean' }, coverage_complete: { type: 'boolean' }, reason: text,
  criteria: { type: 'array', minItems: 1, maxItems: 100, items: { type: 'object', properties: {
    id: text, status: { type: 'string', enum: ['satisfied', 'missing', 'unverified'] }, reason: text,
    evidence: { type: 'array', maxItems: 8, items: citation },
  }, required: ['id', 'status', 'reason', 'evidence'], additionalProperties: false } },
}, required: ['complete', 'explicit_completion', 'coverage_complete', 'reason', 'criteria'], additionalProperties: false }

function parseBounded(raw: string, schema: object): unknown {
  if (Buffer.byteLength(raw, 'utf8') > 40_000) throw new Error('Acceptance record exceeds the 40000-byte budget; full criterion coverage cannot be verified')
  let value: unknown
  try { value = JSON.parse(raw) } catch { throw new Error('Invalid acceptance JSON') }
  const result = validateSchema(schema, value)
  if (!result.valid) throw new Error(`Invalid acceptance record: ${result.errors.join('; ')}`)
  return value
}

/** Citation existence binds interpretation to a source, not proof of semantic coverage. */
export function parseGoalCriteria(raw: string, sources: AcceptanceSource[], sourceFingerprint: string): GoalCriteria {
  const extracted = parseBounded(raw, extractionSchema) as { criteria: Array<Omit<AcceptanceCriterion, 'id'>> }
  const seen = new Set<string>()
  const items = extracted.criteria.map((item, index) => {
    const source = sources.find(entry => entry.id === item.source_id)
    if (!source || !item.quote.trim() || !source.text.includes(item.quote) || !item.text.trim()) throw new Error('Acceptance criterion must cite an exact nonempty original source excerpt')
    const key = item.text.trim().toLowerCase()
    if (seen.has(key)) throw new Error('Duplicate acceptance criterion')
    seen.add(key)
    return { id: `R${index + 1}`, ...item }
  })
  const manifest = { sourceFingerprint, items }
  if (Buffer.byteLength(JSON.stringify(manifest), 'utf8') > 40_000) throw new Error('Acceptance criteria exceed the complete manifest budget')
  return manifest
}

export function validateGoalCriteria(manifest: GoalCriteria, sources: AcceptanceSource[]): GoalCriteria {
  if (!manifest || !Array.isArray(manifest.items) || typeof manifest.sourceFingerprint !== 'string') throw new Error('Invalid saved acceptance criteria')
  const restored = parseGoalCriteria(JSON.stringify({ criteria: manifest.items.map(({ id: _id, ...criterion }) => criterion) }), sources, manifest.sourceFingerprint)
  if (!isDeepStrictEqual(restored, manifest)) throw new Error('Invalid saved acceptance criterion identities')
  return restored
}

export function parseGoalReview(raw: string, manifest: GoalCriteria, sources: EvidenceEntry[], workspaceDigest: string, executionFingerprint?: string): GoalAcceptanceReview {
  const review = parseBounded(raw, reviewSchema) as GoalAcceptanceReview
  if (!review.reason.trim()) throw new Error('Acceptance review needs a reason')
  const latestVerification = [...sources].reverse().find(source => source.kind === 'tool' && source.source === 'verification')
  const assessed = new Set<string>()
  for (const assessment of review.criteria) {
    const criterion = manifest.items.find(item => item.id === assessment.id)
    if (!criterion || assessed.has(assessment.id)) throw new Error('Acceptance review must assess every criterion exactly once')
    assessed.add(assessment.id)
    if (!assessment.reason.trim()) throw new Error('Acceptance assessment needs a reason')
    if (assessment.status === 'satisfied' && !assessment.evidence.length) throw new Error('Satisfied criteria require cited tool evidence')
    const cited = assessment.evidence.map(proof => {
      const source = sources.find(entry => entry.id === proof.source_id && entry.kind === 'tool' && !NON_PROOF_TOOLS.has(entry.source.split(':', 1)[0]!))
      if (!source || !proof.quote.trim() || !source.text.includes(proof.quote)) throw new Error('Acceptance evidence must cite an exact tool source excerpt, not bookkeeping, a model claim, or a summary')
      return source
    })
    if (assessment.status === 'satisfied' && criterion.verification !== 'test' && !cited.some(source => source.source !== 'verification')) throw new Error(`Criterion ${criterion.id} requires a non-test observation; a test receipt alone does not prove inspection or external effects`)
    if (assessment.status === 'satisfied' && criterion.verification === 'test') {
      const passed = cited.some(source => {
        if (source.source !== 'verification' || source.id !== latestVerification?.id) return false
        try {
          return isPassedVerificationForWorkspace(JSON.parse(source.text), workspaceDigest, executionFingerprint)
        } catch { return false }
      })
      if (!passed) throw new Error(`Criterion ${criterion.id} requires a fresh passed executed-test receipt for the current workspace`)
    }
  }
  if (assessed.size !== manifest.items.length) throw new Error('Acceptance review omitted one or more criteria')
  review.complete = review.complete && review.explicit_completion && review.coverage_complete && review.criteria.every(item => item.status === 'satisfied')
  return review
}
