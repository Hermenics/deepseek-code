import { describe, expect, it } from 'bun:test'
import { getImmediateBtwQuestion } from '../src/ui/queueLogic.js'

describe('/btw during loading', () => {
  it('extracts a side question immediately through the shared command parser', () => {
    expect(getImmediateBtwQuestion('/btw what changed?')).toBe('what changed?')
    expect(getImmediateBtwQuestion('/btw')).toBe('')
  })

  it('does not treat the removed /msg command as immediate', () => {
    expect(getImmediateBtwQuestion('/msg old note')).toBeUndefined()
  })
})
