import { describe, it, expect } from 'bun:test'
import {
  SHELL_OUTPUT_MAX_CHARS,
  SHELL_TIMEOUT_MS,
  GREP_MAX_LINES,
  GLOB_MAX_FILES,
  UNDO_STACK_MAX,
  CONTEXT_COMPACT_THRESHOLD,
  DIFF_MAX_LINES,
  CHECKPOINT_MAX,
  SUBAGENT_MAX_ITERATIONS,
  REFINER_MAX_TOKENS,
  REFINER_MIN_LENGTH,
} from '../src/constants.js'

describe('Constants', () => {
  it('SHELL_OUTPUT_MAX_CHARS should be a positive number', () => {
    expect(SHELL_OUTPUT_MAX_CHARS).toBeGreaterThan(0)
    expect(typeof SHELL_OUTPUT_MAX_CHARS).toBe('number')
  })

  it('SHELL_TIMEOUT_MS should be reasonable (5s-120s)', () => {
    expect(SHELL_TIMEOUT_MS).toBeGreaterThanOrEqual(5_000)
    expect(SHELL_TIMEOUT_MS).toBeLessThanOrEqual(120_000)
  })

  it('GREP_MAX_LINES should be positive', () => {
    expect(GREP_MAX_LINES).toBeGreaterThan(0)
  })

  it('GLOB_MAX_FILES should be positive', () => {
    expect(GLOB_MAX_FILES).toBeGreaterThan(0)
  })

  it('UNDO_STACK_MAX should be between 1 and 100', () => {
    expect(UNDO_STACK_MAX).toBeGreaterThanOrEqual(1)
    expect(UNDO_STACK_MAX).toBeLessThanOrEqual(100)
  })

  it('CONTEXT_COMPACT_THRESHOLD should be between 0 and 1', () => {
    expect(CONTEXT_COMPACT_THRESHOLD).toBeGreaterThan(0)
    expect(CONTEXT_COMPACT_THRESHOLD).toBeLessThan(1)
  })

  it('DIFF_MAX_LINES should be positive', () => {
    expect(DIFF_MAX_LINES).toBeGreaterThan(0)
  })

  it('CHECKPOINT_MAX should be positive', () => {
    expect(CHECKPOINT_MAX).toBeGreaterThan(0)
  })

  it('SUBAGENT_MAX_ITERATIONS should be between 1 and 50', () => {
    expect(SUBAGENT_MAX_ITERATIONS).toBeGreaterThanOrEqual(1)
    expect(SUBAGENT_MAX_ITERATIONS).toBeLessThanOrEqual(50)
  })

  it('REFINER_MAX_TOKENS should be positive', () => {
    expect(REFINER_MAX_TOKENS).toBeGreaterThan(0)
  })

  it('REFINER_MIN_LENGTH should be positive', () => {
    expect(REFINER_MIN_LENGTH).toBeGreaterThan(0)
  })

  it('constants should have expected values', () => {
    expect(SHELL_OUTPUT_MAX_CHARS).toBe(50_000)
    expect(SHELL_TIMEOUT_MS).toBe(30_000)
    expect(GREP_MAX_LINES).toBe(200)
    expect(GLOB_MAX_FILES).toBe(500)
    expect(UNDO_STACK_MAX).toBe(10)
    expect(CONTEXT_COMPACT_THRESHOLD).toBe(0.60)
    expect(DIFF_MAX_LINES).toBe(50)
    expect(CHECKPOINT_MAX).toBe(20)
    expect(SUBAGENT_MAX_ITERATIONS).toBe(15)
    expect(REFINER_MAX_TOKENS).toBe(1024)
    expect(REFINER_MIN_LENGTH).toBe(30)
  })
})
