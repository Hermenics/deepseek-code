import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parsePricingPage, withLegacyAliases } from '../scripts/update-deepseek-models.js'

const html = readFileSync(join(import.meta.dir, 'fixtures/deepseek-pricing.html'), 'utf8')

describe('parsePricingPage', () => {
  it('extracts models, limits, prices, peak hours and legacy aliases', () => {
    const data = parsePricingPage(html)
    expect(data.models.map((m) => m.id)).toEqual(['deepseek-flash', 'deepseek-v4-pro'])
    expect(data.models[0]).toEqual({
      id: 'deepseek-flash',
      version: 'DeepSeek-V4.1-Flash',
      contextTokens: 1_000_000,
      maxOutputTokens: 384_000,
      vision: true,
      concurrency: 2500,
      pricing: { offPeak: { cacheHit: 0.003, cacheMiss: 0.15, output: 0.6 }, peak: { cacheHit: 0.006, cacheMiss: 0.3, output: 1.2 } },
    })
    expect(data.models[1]!.vision).toBe(false)
    expect(data.models[1]!.concurrency).toBe(500)
    expect(data.models[1]!.pricing.peak).toEqual({ cacheHit: 0.044, cacheMiss: 1.32, output: 3.96 })
    expect(data.peakHoursUtc).toEqual({ weekdays: [1, 2, 3, 4, 5], ranges: [['01:00', '04:00'], ['06:00', '10:00']] })
    expect(data.legacyAliases).toEqual({ 'deepseek-v4-flash': 'deepseek-flash', 'deepseek-v4-flash-vision-exp': 'deepseek-flash' })
  })

  it('refuses a table that lost a price row instead of writing partial prices', () => {
    const withoutPeakOutput = html.replace('<tr><td>PEAK</td><td>$1.2</td><td>$3.96</td></tr>', '')
    expect(() => parsePricingPage(withoutPeakOutput)).toThrow('Missing output price for deepseek-flash')
  })

  it('refuses a page whose peak-hours note changed shape', () => {
    expect(() => parsePricingPage(html.replace('Peak hours are', 'Busy hours are'))).toThrow(/peak-hours/)
  })

  it('refuses a page without the pricing table', () => {
    expect(() => parsePricingPage('<html><body>Maintenance</body></html>')).toThrow('Pricing table not found')
  })

  it('refuses an unknown vision value instead of treating it as unsupported', () => {
    const betaVision = html.replace('<td>✓</td><td>Not supported</td>', '<td>Beta</td><td>Not supported</td>')
    expect(() => parsePricingPage(betaVision)).toThrow('Unexpected vision value "Beta" for deepseek-flash')
  })
})

describe('withLegacyAliases', () => {
  it('merges extra aliases and rejects any alias whose target model is not listed', () => {
    const data = parsePricingPage(html)
    expect(withLegacyAliases(data, { 'deepseek-chat': 'deepseek-flash' }).legacyAliases).toEqual({
      'deepseek-chat': 'deepseek-flash',
      'deepseek-v4-flash': 'deepseek-flash',
      'deepseek-v4-flash-vision-exp': 'deepseek-flash',
    })
    expect(() => withLegacyAliases(data, { 'deepseek-coder': 'deepseek-v3' })).toThrow('deepseek-coder -> deepseek-v3')
  })
})
