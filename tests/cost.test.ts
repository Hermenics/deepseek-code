import { describe, it, expect } from 'bun:test'
import { estimateCost, formatCost, getContextLimit } from '../src/agent/cost.js'
import type { TokenUsage } from '../src/agent/cost.js'

describe('estimateCost', () => {
  it('should calculate cost for deepseek-chat with no cached tokens', () => {
    const usage: TokenUsage = { promptTokens: 1_000_000, completionTokens: 1_000_000, cachedTokens: 0 }
    const cost = estimateCost('deepseek-chat', usage)
    // input: 1M * $0.27/M = $0.27, output: 1M * $1.10/M = $1.10
    expect(cost).toBeCloseTo(0.27 + 1.10, 4)
  })

  it('should calculate cost for deepseek-chat with cached tokens', () => {
    const usage: TokenUsage = { promptTokens: 1_000_000, completionTokens: 500_000, cachedTokens: 600_000 }
    const cost = estimateCost('deepseek-chat', usage)
    // regular input: (1M - 600K) = 400K * $0.27/M = $0.108
    // cached: 600K * $0.07/M = $0.042
    // output: 500K * $1.10/M = $0.55
    expect(cost).toBeCloseTo(0.108 + 0.042 + 0.55, 4)
  })

  it('should calculate cost for deepseek-reasoner', () => {
    const usage: TokenUsage = { promptTokens: 500_000, completionTokens: 200_000, cachedTokens: 100_000 }
    const cost = estimateCost('deepseek-reasoner', usage)
    // regular input: 400K * $0.55/M = $0.22
    // cached: 100K * $0.14/M = $0.014
    // output: 200K * $2.19/M = $0.438
    expect(cost).toBeCloseTo(0.22 + 0.014 + 0.438, 4)
  })

  it('should fallback to deepseek-chat pricing for unknown model', () => {
    const usage: TokenUsage = { promptTokens: 1_000_000, completionTokens: 1_000_000, cachedTokens: 0 }
    const cost = estimateCost('unknown-model', usage)
    expect(cost).toBeCloseTo(0.27 + 1.10, 4)
  })

  it('should return 0 for zero usage', () => {
    const usage: TokenUsage = { promptTokens: 0, completionTokens: 0, cachedTokens: 0 }
    expect(estimateCost('deepseek-chat', usage)).toBe(0)
  })

  it('should handle cachedTokens greater than promptTokens gracefully', () => {
    // Edge case: cachedTokens > promptTokens (shouldn't happen but must not crash)
    const usage: TokenUsage = { promptTokens: 100, completionTokens: 50, cachedTokens: 200 }
    const cost = estimateCost('deepseek-chat', usage)
    // regularInput = max(0, 100 - 200) = 0
    expect(cost).toBeGreaterThanOrEqual(0)
  })
})

describe('formatCost', () => {
  it('should format very small costs as <$0.0001', () => {
    expect(formatCost(0.00001)).toBe('<$0.0001')
    expect(formatCost(0)).toBe('<$0.0001')
  })

  it('should format normal costs with 4 decimal places', () => {
    expect(formatCost(0.5)).toBe('$0.5000')
    expect(formatCost(1.2345)).toBe('$1.2345')
  })

  it('should format costs at the boundary', () => {
    expect(formatCost(0.0001)).toBe('$0.0001')
  })
})

describe('getContextLimit', () => {
  it('should return 128K for vertex provider (DeepSeek R1)', () => {
    expect(getContextLimit('vertex', 'any-model')).toBe(128_000)
  })

  it('should return 128K for bedrock provider (DeepSeek R1)', () => {
    expect(getContextLimit('bedrock', 'any-model')).toBe(128_000)
  })

  it('should return 128K for deepseek-chat', () => {
    expect(getContextLimit('deepseek', 'deepseek-chat')).toBe(128_000)
  })

  it('should return 128K for deepseek-reasoner', () => {
    expect(getContextLimit('deepseek', 'deepseek-reasoner')).toBe(128_000)
  })

  it('should return 128K as default for unknown model', () => {
    expect(getContextLimit('deepseek', 'unknown-model')).toBe(128_000)
  })
})
