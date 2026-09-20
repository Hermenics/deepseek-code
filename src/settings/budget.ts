/**
 * How much the session is allowed to spend on itself.
 *
 * Every knob below already existed and could be set by hand; what was
 * missing was a way to move all of them at once without knowing what any of
 * them are. Nobody opens a settings menu thinking "I would like a fan-out of
 * two and a compaction threshold of 0.7". They think "I am low on credit
 * this week".
 *
 * Two rules keep this honest:
 *
 *   1. A level may only remove *spending*, never correctness. The mechanical
 *      verification of a subagent's work — the real git diff, the cited
 *      paths, the project's own build — costs nothing but a shell call, so
 *      it survives every level. What the cheapest level drops is the second
 *      language model asked to have an opinion about the first one.
 *
 *   2. The level is a floor, not a ceiling. It merges *underneath* the
 *      user's own settings files, so anything written down explicitly wins.
 *      Saying "I'm broke" should not silently undo a limit someone chose.
 *
 * The middle level is deliberately the behaviour this build already has.
 * A default that quietly trimmed concurrency or narrowed a panel would hand
 * every existing user a downgrade they never asked for, on an upgrade, for
 * a setting they never opened. One direction cuts, the other pushes, and
 * standing still costs nothing.
 */
import type { EffortLevel } from '../commands/types.js'
import type { DeepSeekSettings } from './types.js'

export type BudgetLevel = 'broke' | 'comfortable' | 'loaded'

export const BUDGET_LEVELS: BudgetLevel[] = ['broke', 'comfortable', 'loaded']

export const DEFAULT_BUDGET_LEVEL: BudgetLevel = 'comfortable'

/** When a second model is paid to check the first one's work. */
export type VerifierPolicy = 'never' | 'as-needed' | 'always'

/** How many models answer a single MoA query. */
export type MoaPolicy = 'off' | 'full'

export interface BudgetProfile {
  /** Shown in the menu. Deliberately about the wallet, not about tokens. */
  label: string
  /** One line, in the same voice, saying what the trade actually is. */
  tagline: string
  /** Thinking mode and output ceiling; the largest single lever there is. */
  effort: EffortLevel
  verifier: VerifierPolicy
  moa: MoaPolicy
  /**
   * Merged under the user's settings files. Only paths that cost money
   * belong here — display preferences are free and are left alone.
   */
  settings: DeepSeekSettings
  /** What changes, for the detail pane. Empty at the top level: nothing does. */
  effects: string[]
}

export const BUDGET_PROFILES: Record<BudgetLevel, BudgetProfile> = {
  broke: {
    label: "I'm broke",
    tagline: 'Every token is rent. Cuts the extras, keeps the work correct.',
    effort: 'low',
    verifier: 'never',
    moa: 'off',
    settings: {
      model: { maxOutputTokens: 8192 },
      compaction: { enabled: true, threshold: 0.7 },
      promptRefiner: { enabled: false },
      agents: {
        concurrency: 2,
        maxFanOut: 2,
        maxDepth: 1,
        maxRetries: 0,
        maxCostUsd: 0.5,
      },
    },
    effects: [
      'Thinking is off and replies are capped at 8K tokens.',
      'Delegated work is checked against git and your build, but no second model is paid to review it.',
      'Two subagents at a time, no sub-delegation, no retry after a failure.',
      'Context is compacted at 70% instead of 90%, so each turn carries less.',
      'Mixture-of-agents is off: one model answers, not three.',
      'A delegated task stops at $0.50.',
    ],
  },
  comfortable: {
    label: "I'm comfortable",
    tagline: 'The normal build. Spends where it changes the answer.',
    effort: 'high',
    verifier: 'as-needed',
    moa: 'full',
    // Empty on purpose: this level is what the tool does without one.
    settings: {},
    effects: [
      'Thinking is on at the normal depth.',
      'Delegated work is checked against git and your build, and a second model reviews it when the result warrants one.',
      'No spending cap beyond the ones you set yourself.',
    ],
  },
  loaded: {
    label: "I'm loaded",
    tagline: 'Nothing held back. Depth over receipts.',
    effort: 'max',
    verifier: 'always',
    moa: 'full',
    settings: {},
    effects: [
      'Thinking runs at maximum reasoning effort.',
      'Every delegated result gets a second model to review it, not only the risky ones.',
      'No caps at all.',
    ],
  },
}

export function budgetProfile(level: BudgetLevel | undefined): BudgetProfile {
  return BUDGET_PROFILES[level ?? DEFAULT_BUDGET_LEVEL]
}

export function isBudgetLevel(value: unknown): value is BudgetLevel {
  return typeof value === 'string' && (BUDGET_LEVELS as string[]).includes(value)
}

/**
 * Whether a second model may review a delegated result.
 *
 * The mechanical checks are not part of this decision. They are git and a
 * shell command, they have already run by this point, and they have already
 * had their chance to refute the result. All this decides is whether a
 * model is paid to form an opinion on top.
 */
export function verifierAllowed(level: BudgetLevel | undefined): boolean {
  return budgetProfile(level).verifier !== 'never'
}

/**
 * Whether every delegated result is reviewed, including the ones the usual
 * risk rule would have let through. This is what the top level buys that
 * the middle one does not.
 */
export function verifierForced(level: BudgetLevel | undefined): boolean {
  return budgetProfile(level).verifier === 'always'
}

/** Reference models a single MoA query may consult, given the level. */
export function moaPanelSize(level: BudgetLevel | undefined, configured: number): number {
  switch (budgetProfile(level).moa) {
    case 'off': return 0
    case 'full': return configured
  }
}
