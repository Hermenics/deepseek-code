export { getSessionId, updateLastInteractionTime } from '../utils/ink-shims.js'
/** No-op shim for the upstream interaction-time tracker expected by vendored Ink code. */
export function flushInteractionTime(): void {}
/** No-op shim for the upstream scroll-activity tracker expected by vendored Ink code. */
export function markScrollActivity(): void {}
