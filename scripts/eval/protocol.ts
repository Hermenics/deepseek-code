import { createHash } from 'node:crypto'
import { lstat, readlink, readdir, readFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { redactSecrets } from '../../src/orchestration/events.js'

const OMIT_TRANSCRIPT_KEYS = /reasoning|analysis|thinking|private|chain_of_thought/i

export function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

export function attestCheckerTrees(input: {
  visibleBefore: string; visibleAfter: string; hiddenBefore: string; hiddenAfter: string;
  hiddenGraderCopyHash: string; graderHash: string;
}) {
  const checkerStable = input.visibleBefore === input.visibleAfter && input.hiddenBefore === input.hiddenAfter
  const hiddenGraderStable = input.hiddenGraderCopyHash === input.graderHash
  return {
    checkerStable,
    hiddenGraderStable,
    checkerTreeBefore: fingerprint({ visible: input.visibleBefore, hidden: input.hiddenBefore }),
    checkerTreeAfter: fingerprint({ visible: input.visibleAfter, hidden: input.hiddenAfter }),
    integrityFailures: [
      ...(!checkerStable ? ['workspace changed while checks ran'] : []),
      ...(!hiddenGraderStable ? ['copied hidden grader differs from frozen grader'] : []),
    ],
  }
}

/** Hash a fixture/workspace tree without following symlinks or including volatile runtime state. */
export async function fingerprintTree(root: string, omit = new Set(['.git', 'node_modules', '__eval_check__']), omitRelativePaths = new Set<string>()): Promise<string> {
  const entries: Array<[string, string]> = []
  async function visit(directory: string): Promise<void> {
    for (const name of (await readdir(directory)).sort()) {
      if (omit.has(name)) continue
      const path = join(directory, name)
      const key = relative(root, path).split(sep).join('/')
      if (omitRelativePaths.has(key)) continue
      const info = await lstat(path)
      if (info.isSymbolicLink()) entries.push([key, `link:${await readlink(path)}`])
      else if (info.isDirectory()) await visit(path)
      else if (info.isFile()) entries.push([key, `file:${createHash('sha256').update(await readFile(path)).digest('hex')}`])
      else entries.push([key, `other:${info.mode}`])
    }
  }
  await visit(root)
  return fingerprint(entries)
}

/** Persist only redacted user-visible messages; internal reasoning and private metadata are never written. */
export function transcriptForPersistence(messages: unknown): unknown {
  const strip = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(strip)
    if (!value || typeof value !== 'object') return value
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !OMIT_TRANSCRIPT_KEYS.test(key))
      .map(([key, child]) => [key, strip(child)]))
  }
  return redactSecrets(strip(messages))
}

export interface EvalRecordValidation {
  protocolVersion?: number
  pass?: boolean
  task?: string
  run?: number
  checkerStable?: boolean
  hiddenGraderStable?: boolean
  integrityFailures?: string[]
}

/** Reject malformed current records; legacy records remain readable for descriptive comparisons. */
export function validateEvalRecord(value: unknown): asserts value is EvalRecordValidation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('eval record must be an object')
  const record = value as Record<string, unknown>
  if (typeof record.task !== 'string' || !record.task.trim()) throw new Error('eval record task must be a non-empty string')
  if (typeof record.pass !== 'boolean') throw new Error(`eval record ${record.task} pass must be boolean`)
  if (record.run !== undefined && (!Number.isSafeInteger(record.run) || (record.run as number) < 1)) throw new Error(`eval record ${record.task} run must be a positive integer`)
  if (record.protocolVersion !== undefined && record.protocolVersion !== 2) throw new Error(`unsupported eval protocol version: ${String(record.protocolVersion)}`)
  if (record.protocolVersion === 2) {
    if (typeof record.checkerStable !== 'boolean' || typeof record.hiddenGraderStable !== 'boolean' || !Array.isArray(record.integrityFailures)) throw new Error(`eval record ${record.task} is missing integrity attestation`)
    if (typeof record.initialTreeHash !== 'string' || typeof record.finalTreeHash !== 'string' || typeof record.promptHash !== 'string' || typeof record.graderHash !== 'string' || typeof record.schemaFingerprint !== 'string' || typeof record.runtimeFingerprint !== 'string' || typeof record.configFingerprint !== 'string') throw new Error(`eval record ${record.task} is missing frozen input fingerprints`)
    if (record.pass === true && (record.checkerStable !== true || record.hiddenGraderStable !== true || (record.integrityFailures as unknown[]).length > 0)) throw new Error(`eval record ${record.task} claims pass despite failed integrity checks`)
    for (const key of ['durationMs', 'agentDurationMs', 'checkerDurationMs', 'fixedCostUsd', 'estimatedCostUsd', 'costUsd']) {
      if (record[key] !== undefined && (typeof record[key] !== 'number' || !Number.isFinite(record[key]) || ((key.endsWith('CostUsd') || key === 'costUsd') && (record[key] as number) < 0))) throw new Error(`eval record ${record.task} has invalid ${key}`)
    }
    if (record.actualCostUsd !== undefined && record.actualCostUsd !== null && (typeof record.actualCostUsd !== 'number' || !Number.isFinite(record.actualCostUsd) || record.actualCostUsd < 0)) throw new Error(`eval record ${record.task} has invalid actualCostUsd`)
    const hasRunCostAccounting = ['estimatedCostUsd', 'actualCostUsd', 'costUsd'].some(key => typeof record[key] === 'number' && Number.isFinite(record[key]) && (record[key] as number) >= 0)
    if (!hasRunCostAccounting) throw new Error(`eval record ${record.task} is missing usable run-cost accounting; normalized fixedCostUsd is not spend`)
    if (record.modelSeedSupported !== false) throw new Error(`eval record ${record.task} incorrectly claims model seed support`)
    if (!Array.isArray(record.plannedTaskRunKeys) || record.plannedTaskRunKeys.some(key => typeof key !== 'string') || new Set(record.plannedTaskRunKeys).size !== record.plannedTaskRunKeys.length || typeof record.taskSetFingerprint !== 'string') throw new Error(`eval record ${record.task} is missing planned comparison coverage`)
    if (!(record.plannedTaskRunKeys as string[]).includes(`${record.task}:${record.run}`)) throw new Error(`eval record ${record.task} is absent from its planned comparison coverage`)
  }
}

export function recordHasIntegrityFailure(record: EvalRecordValidation): boolean {
  return record.protocolVersion !== 2 || record.checkerStable !== true || record.hiddenGraderStable !== true || !record.integrityFailures || record.integrityFailures.length > 0
}

/** Promotion requires the same complete task/run matrix; missing or cherry-picked pairs are not evidence. */
export function hasCompleteMatchingCoverage(a: EvalRecordValidation[], b: EvalRecordValidation[]): boolean {
  const coverage = (records: EvalRecordValidation[]) => records.map(record => `${record.task}:${record.run ?? 'legacy'}`).sort()
  const left = coverage(a)
  const right = coverage(b)
  return left.length > 0 && left.length === right.length && left.every((key, index) => key === right[index])
}
