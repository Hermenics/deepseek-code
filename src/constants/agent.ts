/** Max entries kept in the undo stack */
export const UNDO_STACK_MAX = 10

/** Context usage % at which auto-compact triggers */
export const CONTEXT_COMPACT_THRESHOLD = 0.85

/** Token buffer reserved for auto-compact decision */
export const AUTO_COMPACT_BUFFER_TOKENS = 13_000

/** Number of recent tool results to preserve during microCompact */
export const MICRO_COMPACT_KEEP_LAST = 5

/** Max checkpoints stored on disk */
export const CHECKPOINT_MAX = 20

/** Max tokens for prompt refiner response */
export const REFINER_MAX_TOKENS = 1024

/** Min message length to trigger prompt refinement */
export const REFINER_MIN_LENGTH = 30
