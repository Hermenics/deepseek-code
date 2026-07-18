import { createHash } from 'node:crypto'
import { validateSchema } from './schema.js'
import type { OrchestratorSession } from './OrchestratorSession.js'
import type { TaskRunContext } from './types.js'

export const REVIEW_PERSPECTIVES = [
  'correctness', 'security', 'concurrency', 'error-handling', 'regressions',
  'tests', 'compatibility', 'performance', 'maintainability',
] as const
export type ReviewPerspective = typeof REVIEW_PERSPECTIVES[number]
export type FindingClassification = 'CONFIRMED' | 'PLAUSIBLE' | 'REFUTED'

export interface ReviewFindingInput {
  title: string
  description: string
  impact: string
  file?: string
  line?: number
  evidence: string[]
}

export interface NormalizedReviewFinding extends ReviewFindingInput {
  findingId: string
  perspectives: ReviewPerspective[]
  classification: FindingClassification
  verificationReason: string
  verificationEvidence: string[]
  verificationError?: string
}

export interface VerificationAssessment {
  findingId: string
  classification: FindingClassification
  reason: string
  evidence: string[]
}

export interface MultiAgentReviewResult {
  schemaVersion: 1
  findings: NormalizedReviewFinding[]
  reviewerFailures: Array<{ perspective: ReviewPerspective; error: string }>
  verificationAvailable: boolean
  gaps: string[]
  gapSweepError?: string
}

export interface MultiAgentReviewInput {
  task: string
  perspectives?: ReviewPerspective[]
  reviewer(perspective: ReviewPerspective, context: TaskRunContext): Promise<ReviewFindingInput[]>
  verifier?(findings: ReviewFindingInputWithId[], context: TaskRunContext): Promise<VerificationAssessment[]>
  gapSweep?(findings: NormalizedReviewFinding[], context: TaskRunContext): Promise<string[]>
}

interface ReviewFindingInputWithId extends ReviewFindingInput { findingId: string; perspectives: ReviewPerspective[] }

const FINDING_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['title', 'description', 'impact', 'evidence'],
  properties: {
    title: { type: 'string', minLength: 1 }, description: { type: 'string', minLength: 1 },
    impact: { type: 'string', minLength: 1 }, file: { type: 'string', minLength: 1 },
    line: { type: 'integer', minimum: 1 }, evidence: { type: 'array', items: { type: 'string', minLength: 1 } },
  },
} as const

const ASSESSMENT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['findingId', 'classification', 'reason', 'evidence'],
  properties: {
    findingId: { type: 'string', minLength: 1 }, classification: { enum: ['CONFIRMED', 'PLAUSIBLE', 'REFUTED'] },
    reason: { type: 'string', minLength: 1 }, evidence: { type: 'array', items: { type: 'string', minLength: 1 } },
  },
} as const

function validateFindings(value: unknown): ReviewFindingInput[] {
  if (!Array.isArray(value)) throw new Error('Reviewer result must be an array')
  return value.map((item, index) => {
    const validation = validateSchema<ReviewFindingInput>(FINDING_SCHEMA, item)
    if (!validation.valid || !validation.value) throw new Error(`Invalid finding ${index + 1}: ${validation.errors.join('; ')}`)
    return validation.value
  })
}

function fingerprint(finding: ReviewFindingInput): string {
  const canonical = [finding.title, finding.description, finding.file ?? '', finding.line ?? ''].map(value => String(value).trim().toLowerCase()).join('\0')
  return createHash('sha256').update(canonical).digest('hex')
}

function deduplicate(items: Array<{ finding: ReviewFindingInput; perspective: ReviewPerspective }>): ReviewFindingInputWithId[] {
  const unique = new Map<string, ReviewFindingInputWithId>()
  for (const { finding, perspective } of items) {
    const findingId = fingerprint(finding)
    const existing = unique.get(findingId)
    if (existing) {
      if (!existing.perspectives.includes(perspective)) existing.perspectives.push(perspective)
      existing.evidence = [...new Set([...existing.evidence, ...finding.evidence])]
    } else unique.set(findingId, { ...structuredClone(finding), findingId, perspectives: [perspective] })
  }
  return [...unique.values()]
}

function validateAssessments(value: unknown, findings: ReviewFindingInputWithId[]): VerificationAssessment[] {
  if (!Array.isArray(value)) throw new Error('Verifier result must be an array')
  const expected = new Set(findings.map(finding => finding.findingId))
  const seen = new Set<string>()
  const assessments = value.map((item, index) => {
    const validation = validateSchema<VerificationAssessment>(ASSESSMENT_SCHEMA, item)
    if (!validation.valid || !validation.value) throw new Error(`Invalid assessment ${index + 1}: ${validation.errors.join('; ')}`)
    if (!expected.has(validation.value.findingId) || seen.has(validation.value.findingId)) throw new Error(`Unexpected or duplicate assessment '${validation.value.findingId}'`)
    seen.add(validation.value.findingId)
    return validation.value
  })
  if (seen.size !== expected.size) throw new Error(`Verifier assessed ${seen.size} of ${expected.size} findings`)
  return assessments
}

function unverified(findings: ReviewFindingInputWithId[], error: string): NormalizedReviewFinding[] {
  return findings.map(finding => ({
    ...finding, classification: 'PLAUSIBLE', verificationReason: 'Independent verification unavailable',
    verificationEvidence: [], verificationError: error,
  }))
}

export async function runMultiAgentReview(session: OrchestratorSession, input: MultiAgentReviewInput): Promise<MultiAgentReviewResult> {
  const perspectives = [...new Set(input.perspectives ?? REVIEW_PERSPECTIVES)]
  const reviewHandles = perspectives.map(perspective => ({
    perspective,
    handle: session.spawn<ReviewFindingInput[]>({
      type: 'review', mode: 'background', contextMode: 'fresh', permissionProfile: 'researcher-readonly',
      allowDelegation: false, metadata: { perspective, task: input.task },
    }, async context => validateFindings(await input.reviewer(perspective, context))),
  }))
  const settled = await Promise.all(reviewHandles.map(async item => ({ ...item, result: await item.handle.awaitResult() })))
  const reviewerFailures = settled
    .filter(item => item.result.status !== 'done')
    .map(item => ({ perspective: item.perspective, error: item.result.error?.message ?? item.result.status }))
  const raw = settled.flatMap(item => item.result.status === 'done'
    ? (item.result.value ?? []).map(finding => ({ finding, perspective: item.perspective }))
    : [])
  const unique = deduplicate(raw)

  let findings: NormalizedReviewFinding[]
  let verificationAvailable = Boolean(input.verifier)
  let verificationTaskId: string | undefined
  let verificationSucceeded = false
  if (input.verifier && unique.length > 0) {
    const verification = session.spawn<VerificationAssessment[]>({
      type: 'verification', contextMode: 'fresh', permissionProfile: 'researcher-readonly', allowDelegation: false,
      dependencies: settled.filter(item => item.result.status === 'done').map(item => item.handle.taskId),
      metadata: { task: input.task, findingCount: unique.length },
    }, async context => validateAssessments(await input.verifier!(structuredClone(unique), context), unique))
    verificationTaskId = verification.taskId
    const result = await verification.awaitResult()
    if (result.status === 'done' && result.value) {
      verificationSucceeded = true
      const byId = new Map(result.value.map(assessment => [assessment.findingId, assessment]))
      findings = unique.map(finding => {
        const assessment = byId.get(finding.findingId)!
        return { ...finding, classification: assessment.classification, verificationReason: assessment.reason, verificationEvidence: assessment.evidence }
      })
    } else {
      verificationAvailable = false
      findings = unverified(unique, result.error?.message ?? result.status)
    }
  } else {
    verificationAvailable = false
    findings = unverified(unique, input.verifier ? 'No findings to verify' : 'No independent verifier configured')
  }

  let gaps: string[] = []
  let gapSweepError: string | undefined
  if (input.gapSweep) {
    const sweep = session.spawn<string[]>({
      type: 'gap-sweep', contextMode: 'fresh', permissionProfile: 'researcher-readonly', allowDelegation: false,
      dependencies: verificationTaskId && verificationSucceeded ? [verificationTaskId] : [], metadata: { task: input.task },
    }, async context => {
      const value = await input.gapSweep!(structuredClone(findings), context)
      if (!Array.isArray(value) || value.some(gap => typeof gap !== 'string')) throw new Error('Gap sweep result must be an array of strings')
      return value
    })
    const result = await sweep.awaitResult()
    if (result.status === 'done') gaps = result.value ?? []
    else gapSweepError = result.error?.message ?? result.status
  }
  return { schemaVersion: 1, findings, reviewerFailures, verificationAvailable, gaps, gapSweepError }
}
