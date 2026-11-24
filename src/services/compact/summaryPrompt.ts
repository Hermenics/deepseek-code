/**
 * Structured 9-section compact prompt for intelligent summarization.
 * Inspired by Claude Code's approach — preserves key context for continued work.
 */
export const COMPACT_SUMMARY_PROMPT = `You are summarizing a coding conversation to preserve context while reducing token usage.

Create a detailed summary preserving ALL of the following sections:

## 1. Primary Task
What is the user trying to accomplish? What was the original request?

## 2. Key Technical Decisions
What architectural, library, or approach decisions were made and why?
Distinguish observations from hypotheses. Preserve refutations, unresolved uncertainty, and source/claim IDs; never promote a hypothesis or revive a superseded claim. The runtime claim ledger is separate from this summary.

## 3. Current Implementation State
What has been built/modified so far? What's working?

## 4. Files Modified
List ALL file paths that were read, created, or modified with a brief note about each.

## 5. Errors & Solutions
What errors were encountered? How were they resolved?

## 6. Pending Tasks
Use these four labels so the next turn can resume work directly:
- Completed: outcomes supported by retained tool-source evidence; keep the source IDs. A request, assistant summary, claim, or delegation report is not proof.
- Pending: unfinished requirements and acceptance criteria, including items whose status is unverified.
- Blocked: the exact blocking condition or dependency, or "None" when there is no known blocker.
- Next action: one concrete action that advances the task.
Do not infer completion from an earlier summary. Preserve goal status and criteria as pointers to their durable source, not as fulfillment evidence.

## 7. Requirements & Constraints
What rules, limits, or requirements must be respected?

## 8. Code Patterns & Architecture
What patterns, naming conventions, or structure decisions apply?

## 9. Open Questions
Any unresolved issues, ambiguities, or decisions pending user input?

Be thorough but concise. Prioritize actionable context over verbose descriptions.
Preserve exact file paths, function names, and code snippets that are needed to continue work.
When an active goal or acceptance criteria exist, preserve their identifiers and current status for lookup with get_goal. Preserve relevant session_evidence IDs so the next turn can recover exact source text and observations. A compacted summary is a navigation aid only: it is never evidence that a criterion is satisfied, a durable fact is verified, or an action was completed. Do not create or update generic memory from the summary.`

export const COMPACT_SYSTEM_PROMPT = 'You are a precise AI assistant that summarizes technical conversations. Preserve all critical context needed to continue the work seamlessly.'

/** Trusted runtime guidance attached after compaction so the next turn rechecks durable state and evidence. */
export const COMPACT_CONTINUATION_SYSTEM_PROMPT = `After compaction, treat the compacted summary only as a navigation aid, never as proof of completion or a durable fact. If a goal or acceptance criteria exist, call get_goal to recover their current state. Use session_evidence to retrieve exact source evidence and revalidate current state before claiming a criterion is satisfied. Do not create generic memory from the summary.`

/** Reject malformed summaries before discarding conversation evidence. */
export function validateCompactSummary(summary: string): void {
  const headings = [...summary.matchAll(/^##\s+(\d+)\.\s+[^\n]+$/gm)]
  if (headings.length !== 9 || headings.some((heading, index) => Number(heading[1]) !== index + 1)) throw new Error('Compaction summary must contain all nine ordered sections; history was preserved')
  for (let index = 0; index < headings.length; index++) {
    const heading = headings[index]!
    if (!summary.slice(heading.index! + heading[0].length, headings[index + 1]?.index ?? summary.length).trim()) throw new Error(`Compaction section ${index + 1} is empty; history was preserved`)
  }

  const pendingTasks = summary.slice(headings[5]!.index! + headings[5]![0].length, headings[6]!.index)
  for (const label of ['Completed', 'Pending', 'Blocked', 'Next action']) {
    if (!new RegExp(`^-[ \\t]+${label}:[ \\t]*\\S`, 'm').test(pendingTasks)) {
      throw new Error(`Compaction summary must preserve the ${label} state in section 6; history was preserved`)
    }
  }
}
