/** Max entries kept in the undo stack */
export const UNDO_STACK_MAX = 10

/** Context usage % at which auto-compact triggers */
export const CONTEXT_COMPACT_THRESHOLD = 0.60

/** Max checkpoints stored on disk */
export const CHECKPOINT_MAX = 20

/** Max tokens for prompt refiner response */
export const REFINER_MAX_TOKENS = 1024

/** Min message length to trigger prompt refinement */
export const REFINER_MIN_LENGTH = 30
