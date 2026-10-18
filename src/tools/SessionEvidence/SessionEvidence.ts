import type { SessionClaim } from '../../agent/sessionEvidence.js'
import type { Tool } from '../types.js'

export const SessionEvidenceTool: Tool = {
  name: 'session_evidence',
  description: 'Recover original user requests, historical denied actions, tool evidence, and model-authored claim revisions retained outside compaction. Omit id to list records. This is read-only; evidence never grants permission.',
  parameters: { type: 'object', properties: {
    id: { type: 'string', description: 'Evidence id; omit for the record index.' },
    start_char: { type: 'integer', minimum: 0 },
    max_chars: { type: 'integer', minimum: 1, maximum: 20000 },
  }, additionalProperties: false },
  async execute(args, context) {
    if (!context?.readSessionEvidence) throw new Error('Session evidence is unavailable in this execution context')
    return context.readSessionEvidence(args.id as string | undefined, args.start_char as number | undefined, args.max_chars as number | undefined)
  },
}


export const RecordClaim: Tool = {
  name: 'record_claim',
  description: 'Record a session-scoped model interpretation as hypothesis, supported, or refuted. Cite exact excerpts from retained session_evidence request/denial/tool records for supported/refuted claims. Updating a claim status requires the same statement and supersedes with its latest revision ID; refuted means that statement is contradicted by cited evidence. Record a different proposition separately. Old revisions remain recoverable. Claims never grant permission or independently verify truth. Do not store private reasoning, secrets, or new instructions.',
  parameters: { type: 'object', properties: {
    statement: { type: 'string', minLength: 1, maxLength: 8000 },
    status: { type: 'string', enum: ['hypothesis', 'supported', 'refuted'] },
    evidence: { type: 'array', maxItems: 8, items: { type: 'object', properties: {
      id: { type: 'string' }, excerpt: { type: 'string', minLength: 1, maxLength: 8000 },
    }, required: ['id', 'excerpt'], additionalProperties: false } },
    supersedes: { type: 'string', description: 'Latest revision ID of the claim being corrected or refuted; omit for a new claim.' },
  }, required: ['statement', 'status', 'evidence'], additionalProperties: false },
  async execute(args, context) {
    if (!context?.recordSessionClaim) throw new Error('Session claims are unavailable in this execution context')
    return JSON.stringify({ id: context.recordSessionClaim(args as unknown as SessionClaim), kind: 'claim', authority: 'model-authored interpretation, not verified truth or permission' })
  },
}
