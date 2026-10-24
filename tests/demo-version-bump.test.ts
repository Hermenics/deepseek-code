import { describe, expect, test } from 'bun:test'
import { isVersionBump } from '../scripts/demo/version-bump.js'

describe('demo recording version gate', () => {
  test('records a greater SemVer version', () => {
    expect(isVersionBump('0.13.2', '0.13.3')).toBe(true)
    expect(isVersionBump('0.9.8', '0.10.0')).toBe(true)
  })

  test('skips unchanged, invalid, and lower versions', () => {
    expect(isVersionBump('0.13.2', '0.13.2')).toBe(false)
    expect(isVersionBump('0.13.2', '0.13')).toBe(false)
    expect(isVersionBump('0.13.2', '0.12.9')).toBe(false)
    expect(isVersionBump(undefined, undefined)).toBe(false)
  })
})
