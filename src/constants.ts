// ── Centralized constants — no magic numbers scattered across the codebase ──

/** Max characters returned by shell stdout/stderr */
export const SHELL_OUTPUT_MAX_CHARS = 50_000

/** Default shell command timeout in milliseconds */
export const SHELL_TIMEOUT_MS = 30_000

/** Max lines returned by grep */
export const GREP_MAX_LINES = 200

/** Max files returned by glob */
export const GLOB_MAX_FILES = 500

/** Max entries kept in the undo stack */
export const UNDO_STACK_MAX = 10

/** Context usage % at which auto-compact triggers */
export const CONTEXT_COMPACT_THRESHOLD = 0.60

/** Max diff lines shown in DiffView */
export const DIFF_MAX_LINES = 50

/** Max checkpoints stored on disk */
export const CHECKPOINT_MAX = 20

/** Max subagent iterations */
export const SUBAGENT_MAX_ITERATIONS = 15

/** Max tokens for prompt refiner response */
export const REFINER_MAX_TOKENS = 1024

/** Min message length to trigger prompt refinement */
export const REFINER_MIN_LENGTH = 30
