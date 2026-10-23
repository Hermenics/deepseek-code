interface TestSummaryEvidence {
  position: number
  testCount: number | null
  failureCount: number | null
}

export type SupportedTestRunner = 'bun' | 'pytest' | 'cargo' | 'go' | 'text'

const TEXT_SUMMARY_START = /^\s*(?:Tests?(?::|\s+\d)|test result:|\d+ (?:passed|failed|passing|failing|skipped|deselected|pending|todo|xfailed|xpassed)\b)/i
const TEXT_SUMMARY_OUTCOME = /\b(\d+) (passed|failed|passing|failing|skipped|deselected|pending|todo|xfailed|xpassed)\b/gi

/** Select the last recognized summary belonging to the runner selected for execution. */
function lastSummaryEvidence(lines: string[], runner?: SupportedTestRunner): TestSummaryEvidence | null {
  const candidates: TestSummaryEvidence[] = []
  const includeBun = runner === undefined || runner === 'bun'
  const includeText = runner === undefined || runner === 'pytest' || runner === 'cargo' || runner === 'text'
  for (let position = 0; position < lines.length; position++) {
    const line = lines[position]!
    if (includeBun && /^\s*Ran \d+ tests? across \d+ files?\b/i.test(line)) {
      let passed: number | undefined
      let failed: number | undefined
      for (let index = position - 1; index >= Math.max(0, position - 12); index--) {
        const count = lines[index]!.match(/^\s*(\d+) (pass|fail)\s*$/i)
        if (!count) continue
        if (count[2]!.toLowerCase() === 'pass' && passed === undefined) passed = Number(count[1])
        if (count[2]!.toLowerCase() === 'fail' && failed === undefined) failed = Number(count[1])
      }
      candidates.push({
        position,
        testCount: passed !== undefined && failed !== undefined ? passed + failed : null,
        failureCount: failed ?? null,
      })
    }

    const normalized = normalizeTextSummaryLine(line)
    if (!includeText || runner === 'pytest' && !isPytestTerminalSummary(line) || runner === 'cargo' && !/^\s*test result:/i.test(normalized)) continue
    if (!TEXT_SUMMARY_START.test(normalized)) continue
    const outcomes = [...normalized.matchAll(TEXT_SUMMARY_OUTCOME)]
    if (outcomes.length === 0) continue
    const total = outcomes.reduce((count, outcome) => count + (/^(?:skipped|deselected|pending|todo)$/i.test(outcome[2]!) ? 0 : Number(outcome[1])), 0)
    const failures = outcomes.reduce((count, outcome) => count + (/^(?:failed|failing)$/i.test(outcome[2]!) ? Number(outcome[1]) : 0), 0)
    candidates.push({ position, testCount: total, failureCount: failures })
  }

  if (candidates.length === 0) return null
  const lastPosition = Math.max(...candidates.map(candidate => candidate.position))
  const lastCandidates = candidates.filter(candidate => candidate.position === lastPosition)
  const selected = lastCandidates[0]!
  if (lastCandidates.some(candidate => candidate.testCount !== selected.testCount || candidate.failureCount !== selected.failureCount)) {
    return { position: lastPosition, testCount: null, failureCount: null }
  }
  return selected
}

/** Count executed, non-skipped tests from supported runner summaries; absence remains unknown. */
export function verificationTestCount(output: string, runner?: SupportedTestRunner): number | null {
  const lines = output.replace(/\r\n/g, '\n').split('\n')
  const summary = lastSummaryEvidence(lines, runner)
  if (summary) return summary.testCount
  if (runner && runner !== 'go') return null

  let eventCount = 0, foundEvent = false
  for (const line of lines) {
    if (line.startsWith('{')) {
      try {
        const event = JSON.parse(line)
        if (event.Action === 'run' && typeof event.Test === 'string') { eventCount++; foundEvent = true }
        if (event.Action === 'skip' && typeof event.Test === 'string') eventCount--
      } catch { /* Non-JSON runner output is allowed alongside structured events. */ }
    }
  }
  return foundEvent ? Math.max(0, eventCount) : null
}

/** Return explicit failures from the final supported summary, without changing the executed-test total. */
export function verificationTestFailureCount(output: string, runner?: SupportedTestRunner): number | null {
  const lines = output.replace(/\r\n/g, '\n').split('\n')
  const summary = lastSummaryEvidence(lines, runner)
  if (summary) return summary.failureCount
  if (runner && runner !== 'go') return null

  let eventFailures = 0
  let foundEvent = false
  for (const line of lines) {
    if (!line.startsWith('{')) continue
    try {
      const event = JSON.parse(line)
      if (event.Action === 'run' && typeof event.Test === 'string') foundEvent = true
      if (event.Action === 'fail' && typeof event.Test === 'string') eventFailures++
    } catch { /* Non-JSON runner output is allowed alongside structured events. */ }
  }
  return foundEvent ? eventFailures : null
}

/** Pytest wraps its final outcome counts with `=` separators in terminal summaries. */
function normalizeTextSummaryLine(line: string): string {
  return line.replace(/^\s*=+\s*/, '').replace(/\s*=+\s*$/, '')
}

/** Accept pytest's terminal footer, not arbitrary `N passed` output from a different runner. */
function isPytestTerminalSummary(line: string): boolean {
  const normalized = normalizeTextSummaryLine(line)
  return /^\s*\d+ (?:passed|failed|skipped|deselected|xfailed|xpassed)(?:,\s*\d+ (?:passed|failed|skipped|deselected|xfailed|xpassed))*\s+in\s+[\d.]+s\s*$/i.test(normalized)
}

/**
 * A summary-shaped line is not execution evidence by itself: arbitrary package scripts can print
 * `1 pass`. Count summaries only when the configured script contains a supported runner command.
 * This intentionally accepts only a single direct runner invocation and rejects shell expansion
 * and redirection that could run side commands or inject forged summary output.
 */
// shortcut: accept direct invocations only; use a shell AST plus executable identity before accepting wrappers or assignments.
export function hasSupportedTestRunnerInvocation(script: string): boolean {
  return supportedTestRunnerInvocation(script) !== null
}

/** Identify the runner whose terminal format is eligible to establish execution evidence. */
export function supportedTestRunnerInvocation(script: string): SupportedTestRunner | null {
  const segments: string[] = []
  let start = 0
  let quote: "'" | '"' | '`' | null = null
  let escaped = false
  let unsafeShellSyntax = false
  for (let index = 0; index < script.length; index++) {
    const char = script[index]!
    if (escaped) { escaped = false; continue }
    if (quote === "'") {
      if (char === "'") quote = null
      continue
    }
    if (char === '\\') { escaped = true; continue }
    if (quote) {
      if (char === quote) quote = null
      else if (char === '$' || char === '`') unsafeShellSyntax = true
      continue
    }
    if (char === "'" || char === '"' || char === '`') {
      if (char === '`') unsafeShellSyntax = true
      quote = char
      continue
    }
    if (char === '$' || char === '(' || char === ')' || char === '<' || char === '>') unsafeShellSyntax = true
    if (char === ';' || char === '&' || char === '|' || char === '\n') {
      segments.push(script.slice(start, index))
      if ((char === '&' || char === '|') && script[index + 1] === char) index++
      start = index + 1
    }
  }
  segments.push(script.slice(start))

  const runnerAtStart = /^(bun\s+test|vitest\s+run|jest|mocha|pytest|python(?:3(?:\.\d+)?)?\s+-I\s+-m\s+pytest|cargo\s+test|go\s+test)(?=\s|$)/i
  const invocation = !unsafeShellSyntax && segments.length === 1 ? segments[0]!.trim().match(runnerAtStart)?.[1]?.toLowerCase() : undefined
  if (!invocation) return null
  if (invocation.startsWith('bun ')) return 'bun'
  if (invocation === 'pytest' || invocation.startsWith('python')) return 'pytest'
  if (invocation.startsWith('cargo ')) return 'cargo'
  if (invocation.startsWith('go ')) return 'go'
  return 'text'
}

