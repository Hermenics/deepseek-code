/**
 * Mechanical verification — the part of checking a subagent's work that needs
 * no model at all.
 *
 * Handing a candidate's summary to a second model buys less independence than
 * it appears to. Both models share the priors that produced the mistake, and
 * the reviewer sees only what the candidate chose to write down: an agent that
 * silently edited a file it never mentioned is invisible to a reviewer reading
 * its summary, no matter how clean that reviewer's context is.
 *
 * The checks here are narrower and worth more, because git, the filesystem and
 * the project's own build have no opinion about whether the work went well.
 * Every finding names a fact someone can go and look at.
 */
import { execa } from 'execa'
import { stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import type { SubAgentResult } from './contracts.js'

export interface GroundingReport {
  /** True when a check found hard evidence against the result. */
  refuted: boolean
  issues: string[]
  /** What was observed — including the checks that passed or were skipped. */
  evidence: string[]
}

export interface GroundingInput {
  workspace: string
  /** Dirty paths captured before the run; `null` when this is not a git repo. */
  baseline: Set<string> | null
  result: SubAgentResult
  /** Shell command that must exit 0 after a change, e.g. `bun run typecheck`. */
  verifyCommand?: string
  signal?: AbortSignal
}

/**
 * Paths git considers dirty, relative to the workspace root, or `null` when
 * git cannot answer (no repository, no binary).
 *
 * `-z` is what makes this trustworthy: the porcelain text format quotes and
 * escapes paths containing spaces or non-ASCII, and parsing that back is a
 * source of silent misses. NUL-separated output needs no unquoting.
 */
export async function dirtyPaths(
  workspace: string,
  signal?: AbortSignal,
): Promise<Set<string> | null> {
  const result = await execa(
    'git',
    ['status', '--porcelain=v1', '-z', '--untracked-files=all'],
    { cwd: workspace, cancelSignal: signal, reject: false },
  ).catch(() => undefined)
  if (!result || result.exitCode !== 0) return null

  const fields = result.stdout.split('\0')
  const paths = new Set<string>()
  for (let index = 0; index < fields.length; index++) {
    const field = fields[index]
    // Each entry is `XY <path>`; the trailing split produces one empty field.
    if (field === undefined || field.length < 4) continue
    paths.add(field.slice(3))
    // A rename or copy emits its source as the following field. That source
    // path changed too — it stopped existing — so it counts as touched.
    // The status is two columns, index then worktree, and the format allows
    // R and C in either. Reading only the first would leave the source path
    // unconsumed, and the next pass would treat it as a status record and
    // add its own name minus three characters to the set.
    if (field[0] === 'R' || field[0] === 'C' || field[1] === 'R' || field[1] === 'C') {
      index++
      const source = fields[index]
      if (source) paths.add(source)
    }
  }
  return paths
}

/** Claimed paths arrive absolute or relative; git always speaks relative. */
function toWorkspaceRelative(workspace: string, path: string): string {
  const absolute = isAbsolute(path) ? path : resolve(workspace, path)
  return relative(workspace, absolute) || path
}

function tail(text: string, limit: number): string {
  const trimmed = text.trim()
  return trimmed.length <= limit ? trimmed : `…${trimmed.slice(-limit)}`
}

export async function groundResult(input: GroundingInput): Promise<GroundingReport> {
  const { workspace, baseline, result, verifyCommand, signal } = input
  const issues: string[] = []
  const evidence: string[] = []

  const claimed = new Set(
    result.filesChanged.map(path => toWorkspaceRelative(workspace, path)),
  )
  const after = baseline === null ? null : await dirtyPaths(workspace, signal)

  if (after === null) {
    evidence.push(
      'Diff check skipped: git could not report the workspace state, so undeclared edits cannot be ruled out.',
    )
  } else {
    // Only paths that became dirty during this run are attributable to it.
    const touched = [...after].filter(path => !baseline!.has(path))
    const undeclared = touched.filter(path => !claimed.has(path))
    // A claimed path that git now sees as clean contradicts the claim. Paths
    // already dirty at baseline stay out of `touched` but are still in
    // `after`, so editing a file someone else had open is not a phantom.
    const phantom = [...claimed].filter(path => !after.has(path))

    evidence.push(
      `git: ${touched.length} path(s) changed during the run; the result declared ${claimed.size}.`,
    )
    if (undeclared.length > 0) {
      issues.push(`Changed without declaring it: ${undeclared.join(', ')}`)
    }
    if (phantom.length > 0) {
      issues.push(`Declared as changed, but git sees no change: ${phantom.join(', ')}`)
    }
  }

  // A path the agent claims to have read must exist — reading a file that is
  // not there is not something that can happen. Claimed *changes* are exempt
  // when git is available, since a deletion is a legitimate change that
  // leaves nothing to stat.
  const cited =
    after === null
      ? result.filesRead
      : [...new Set([...result.filesRead, ...result.filesChanged])]
  const missing: string[] = []
  for (const path of cited) {
    const workspaceRelative = toWorkspaceRelative(workspace, path)
    if (after?.has(workspaceRelative)) continue
    const absolute = isAbsolute(path) ? path : resolve(workspace, path)
    const found = await stat(absolute).then(
      () => true,
      () => false,
    )
    if (!found) missing.push(path)
  }
  if (missing.length > 0) issues.push(`Cited paths that do not exist: ${missing.join(', ')}`)

  if (verifyCommand === undefined) {
    evidence.push('No agents.verifyCommand configured; the project build and tests were not run.')
  } else if (result.filesChanged.length === 0) {
    evidence.push(`Nothing changed, so \`${verifyCommand}\` was not run.`)
  } else {
    const check = await execa(verifyCommand, {
      cwd: workspace,
      shell: true,
      cancelSignal: signal,
      reject: false,
      timeout: 300_000,
    }).catch((error: Error) => ({ exitCode: 1, stdout: '', stderr: error.message }))
    if (check.exitCode === 0) {
      evidence.push(`\`${verifyCommand}\` exited 0.`)
    } else {
      issues.push(`\`${verifyCommand}\` exited ${check.exitCode}`)
      evidence.push(tail(`${check.stdout}\n${check.stderr}`, 2000))
    }
  }

  return { refuted: issues.length > 0, issues, evidence }
}
