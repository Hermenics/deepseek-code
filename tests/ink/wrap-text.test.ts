import { describe, expect, it } from 'bun:test'
import wrapText from '../../src/ink/wrap-text.js'

describe('text wrapping', () => {
  it('moves a whole word instead of splitting it at the width', () => {
    const wrapped = wrapText('um dos setores', 8, 'wrap')

    expect(wrapped.replaceAll(' \n', '\n')).toBe('um dos\nsetores')
  })

  it('hard-wraps only a word that is longer than the available width', () => {
    expect(wrapText('abcdefgh', 4, 'wrap-trim')).toBe('abcd\nefgh')
  })
})
