import { describe, it, expect } from 'bun:test'
import { estimateCost, formatCost, getContextLimit, isPeakTime } from '../src/agent/cost.js'
import type { TokenUsage } from '../src/agent/cost.js'
import DEEPSEEK from '../src/agent/deepseekModels.json'

// Rates and peak hours come from the synced data file, so these tests survive DeepSeek price changes.
const model = (id: string) => DEEPSEEK.models.find((m) => m.id === id)!
const { weekdays, ranges } = DEEPSEEK.peakHoursUtc
/** 2026-09-13 is a Sunday, so 13 + weekday lands on that UTC weekday. */
const at = (weekday: number, hhmm: string) => new Date(`2026-09-${13 + weekday}T${hhmm}:00Z`)
const PEAK = at(weekdays[0]!, ranges[0]![0]!)
const offPeakDay = [0, 1, 2, 3, 4, 5, 6].find((day) => !weekdays.includes(day))
const OFF_PEAK = offPeakDay === undefined ? at(weekdays[0]!, ranges[0]![1]!) : at(offPeakDay, ranges[0]![0]!)
const MILLION: TokenUsage = { promptTokens: 1_000_000, completionTokens: 1_000_000, cachedTokens: 0 }

describe('isPeakTime', () => {
  it('follows the synced peak schedule with exclusive range ends', () => {
    expect(isPeakTime(PEAK)).toBe(true)
    expect(isPeakTime(OFF_PEAK)).toBe(false)
    const rangeEnd = ranges[0]![1]!
    expect(isPeakTime(at(weekdays[0]!, rangeEnd))).toBe(ranges.some(([start, end]) => start! <= rangeEnd && rangeEnd < end!))
  })
})

describe('estimateCost', () => {
  const flash = model('deepseek-flash').pricing

  it('prices off-peak and peak usage with their own rates', () => {
    expect(estimateCost('deepseek-flash', MILLION, OFF_PEAK)).toBeCloseTo(flash.offPeak.cacheMiss + flash.offPeak.output, 6)
    expect(estimateCost('deepseek-flash', MILLION, PEAK)).toBeCloseTo(flash.peak.cacheMiss + flash.peak.output, 6)
  })

  it('bills cached tokens at the cache-hit rate instead of the cache-miss rate', () => {
    const usage: TokenUsage = { promptTokens: 1_000_000, completionTokens: 500_000, cachedTokens: 600_000 }
    const { cacheMiss, cacheHit, output } = flash.offPeak
    expect(estimateCost('deepseek-flash', usage, OFF_PEAK)).toBeCloseTo(0.4 * cacheMiss + 0.6 * cacheHit + 0.5 * output, 6)
  })

  it('prices Pro separately from Flash', () => {
    const pro = model('deepseek-v4-pro').pricing.offPeak
    expect(estimateCost('deepseek-v4-pro', MILLION, OFF_PEAK)).toBeCloseTo(pro.cacheMiss + pro.output, 6)
  })

  it('prices retired names and unknown models as Flash', () => {
    const expected = estimateCost('deepseek-flash', MILLION, OFF_PEAK)
    for (const id of ['deepseek-chat', 'deepseek-reasoner', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp', 'unknown-model']) {
      expect(estimateCost(id, MILLION, OFF_PEAK)).toBeCloseTo(expected, 6)
    }
  })

  it('should return 0 for zero usage', () => {
    expect(estimateCost('deepseek-flash', { promptTokens: 0, completionTokens: 0, cachedTokens: 0 })).toBe(0)
  })

  it('never bills more cached tokens than the prompt contained', () => {
    const usage: TokenUsage = { promptTokens: 100, completionTokens: 50, cachedTokens: 200 }
    const { cacheHit, output } = flash.offPeak
    expect(estimateCost('deepseek-flash', usage, OFF_PEAK)).toBeCloseTo((100 * cacheHit + 50 * output) / 1_000_000, 12)
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

  it('uses the published context window for listed models and their retired names', () => {
    const flashContext = model('deepseek-flash').contextTokens
    expect(getContextLimit('deepseek', 'deepseek-v4-pro')).toBe(model('deepseek-v4-pro').contextTokens)
    for (const id of ['deepseek-flash', 'deepseek-chat', 'deepseek-reasoner', 'deepseek-v4-flash-vision-exp']) {
      expect(getContextLimit('deepseek', id)).toBe(flashContext)
    }
  })

  it('keeps explicit limits for non-DeepSeek models', () => {
    expect(getContextLimit('deepseek', 'gpt-5.6-luna')).toBe(1_050_000)
  })

  it('should return 128K as conservative default for unknown model', () => {
    expect(getContextLimit('deepseek', 'unknown-model')).toBe(128_000)
  })
})
