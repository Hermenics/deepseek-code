import { logForDebugging } from '../utils/debug.js'

/** Logs a debug warning when a defined layout value is not an integer; used to spot bad Yoga output before it is clamped. */
export function ifNotInteger(value: number | undefined, name: string): void {
  if (value === undefined) return
  if (Number.isInteger(value)) return
  logForDebugging(`${name} should be an integer, got ${value}`, {
    level: 'warn',
  })
}
