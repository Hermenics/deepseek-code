import { expect, it } from 'bun:test'
import { parseGoalCriteria, parseGoalReview, validateGoalCriteria } from '../src/agent/goalAcceptance.js'
import type { EvidenceEntry } from '../src/agent/sessionEvidence.js'

const sources = [{ id: 'objective', text: 'Implement A and preserve B.' }]
const extracted = JSON.stringify({ criteria: [
  { text: 'Implement A.', source_id: 'objective', quote: 'Implement A', verification: 'test' },
  { text: 'Preserve B.', source_id: 'objective', quote: 'preserve B', verification: 'inspection' },
] })
const fingerprint = 'a'.repeat(64)
const executionFingerprint = 'b'.repeat(64)
const tool: EvidenceEntry = { id: 'test-receipt', kind: 'tool', source: 'verification', text: JSON.stringify({
  status: 'passed', ok: true, exitCode: 0, testCount: 2, inputDigest: fingerprint, finalDigest: fingerprint,
  executionEnvironment: 'host', executionFingerprint, finalExecutionFingerprint: executionFingerprint,
  command: { command: 'bun', args: ['run', 'test'], display: 'bun run test' }, output: 'A succeeds; B preserved',
}) }
const inspection: EvidenceEntry = { id: 'inspection', kind: 'tool', source: 'read_file:contract', text: 'B preserved' }
const review = () => ({ complete: true, explicit_completion: true, coverage_complete: true, reason: 'Both checked.', criteria: [
  { id: 'R1', status: 'satisfied', reason: 'A checked.', evidence: [{ source_id: tool.id, quote: 'A succeeds' }] },
  { id: 'R2', status: 'satisfied', reason: 'B inspected.', evidence: [{ source_id: inspection.id, quote: 'B preserved' }] },
] })

it('extracts stable typed criteria tied to literal original sources', () => {
  const manifest = parseGoalCriteria(extracted, sources, fingerprint)
  expect(manifest.sourceFingerprint).toBe(fingerprint)
  expect(manifest.items.map(item => item.id)).toEqual(['R1', 'R2'])
  expect(manifest.items[0]?.verification).toBe('test')
  expect(() => parseGoalCriteria(extracted.replace('Implement A"', 'Invented source"'), sources, fingerprint)).toThrow('source')
  expect(() => parseGoalCriteria('{"criteria":[]}', sources, fingerprint)).toThrow()
  expect(() => parseGoalCriteria(extracted.replace('"test"', '"guess"'), sources, fingerprint)).toThrow()
})

it('requires exactly one supported assessment per criterion and a fresh executed-test receipt', () => {
  const manifest = parseGoalCriteria(extracted, sources, fingerprint)
  expect(parseGoalReview(JSON.stringify(review()), manifest, [tool, inspection], fingerprint, executionFingerprint).complete).toBe(true)
  for (const mutate of [
    (value: ReturnType<typeof review>) => value.criteria.pop(),
    (value: ReturnType<typeof review>) => value.criteria.push(value.criteria[0]!),
    (value: ReturnType<typeof review>) => { value.criteria[0]!.id = 'unknown' },
    (value: ReturnType<typeof review>) => { value.criteria[0]!.evidence = [] },
    (value: ReturnType<typeof review>) => { value.criteria[0]!.evidence[0]!.quote = 'invented success' },
  ]) {
    const value = review(); mutate(value)
    expect(() => parseGoalReview(JSON.stringify(value), manifest, [tool, inspection], fingerprint, executionFingerprint)).toThrow()
  }
  for (const changes of [{ captureTruncated: true }, { drainTimedOut: true }, { testCount: 0 }, { testCount: 0.5 }, { exitCode: 1 }, { status: 'stale' }, { finalDigest: 'b'.repeat(64) }, { ok: false }]) {
    const stale = { ...tool, text: JSON.stringify({ ...JSON.parse(tool.text), ...changes }) }
    expect(() => parseGoalReview(JSON.stringify(review()), manifest, [stale, inspection], fingerprint, executionFingerprint)).toThrow('test')
  }
  expect(() => parseGoalReview(JSON.stringify(review()), manifest, [{ ...tool, kind: 'claim' }, inspection], fingerprint, executionFingerprint)).toThrow('source')
  for (const source of ['get_goal:last-review', 'subagent:summary', 'todo:done', 'memory:remembered']) expect(() => parseGoalReview(JSON.stringify(review()), manifest, [tool, { ...inspection, source }], fingerprint, executionFingerprint)).toThrow('source')
  expect(() => parseGoalReview(JSON.stringify(review()), manifest, [tool, inspection, { ...tool, id: 'newer', text: JSON.stringify({ status: 'failed' }) }], fingerprint, executionFingerprint)).toThrow('test')
  expect(() => parseGoalReview(JSON.stringify(review()), manifest, [tool, inspection], fingerprint, 'c'.repeat(64))).toThrow('test')
  expect(() => parseGoalReview(JSON.stringify(review()), manifest, [{ ...tool, text: JSON.stringify({ ...JSON.parse(tool.text), finalExecutionFingerprint: undefined }) }, inspection], fingerprint, executionFingerprint)).toThrow('test')
})

it('retains missing and unverified criteria instead of accepting an overall approval', () => {
  const manifest = parseGoalCriteria(extracted, sources, fingerprint)
  const value = review()
  value.criteria[1]!.status = 'unverified'
  value.criteria[1]!.evidence = []
  expect(parseGoalReview(JSON.stringify(value), manifest, [tool, inspection], fingerprint, executionFingerprint).complete).toBe(false)
  value.criteria[1]!.status = 'satisfied'
  value.criteria[1]!.evidence = [{ source_id: inspection.id, quote: 'B preserved' }]
  value.coverage_complete = false
  expect(parseGoalReview(JSON.stringify(value), manifest, [tool, inspection], fingerprint, executionFingerprint).complete).toBe(false)
})


it('validates saved manifest identities and rejects excessive or ambiguous extraction', () => {
  const manifest = parseGoalCriteria(extracted, sources, fingerprint)
  expect(validateGoalCriteria(JSON.parse(JSON.stringify(manifest)), sources)).toEqual(manifest)
  expect(validateGoalCriteria({ items: manifest.items, sourceFingerprint: fingerprint }, sources)).toEqual(manifest)
  const forged = structuredClone(manifest)
  forged.items[0]!.id = 'R99'
  expect(() => validateGoalCriteria(forged, sources)).toThrow('identities')
  const duplicate = JSON.parse(extracted)
  duplicate.criteria.push(duplicate.criteria[0])
  expect(() => parseGoalCriteria(JSON.stringify(duplicate), sources, fingerprint)).toThrow('Duplicate')
  expect(() => parseGoalCriteria('x'.repeat(40_001), sources, fingerprint)).toThrow('budget')
  const value = review()
  value.criteria[1]!.evidence = [{ source_id: tool.id, quote: 'B preserved' }]
  expect(() => parseGoalReview(JSON.stringify(value), manifest, [tool, inspection], fingerprint, executionFingerprint)).toThrow('non-test observation')
})
