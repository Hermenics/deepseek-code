/** Services never throw for expected failures: they return one of these. */
export type Result<T, E extends string> = { ok: true; value: T } | { ok: false; error: E }

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value })
export const err = <E extends string>(error: E): Result<never, E> => ({ ok: false, error })
