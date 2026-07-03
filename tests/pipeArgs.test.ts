import { describe, expect, it } from 'bun:test'
import { parsePipeArgs } from '../src/entrypoints/pipe.js'

describe('parsePipeArgs', () => {
  it('removes pipe flags from prompt args', () => {
    expect(parsePipeArgs(['--pipe', 'explain', 'this'])).toEqual({
      json: false,
      promptArgs: ['explain', 'this'],
    })
  })

  it('enables JSON output without leaking the flag into the prompt', () => {
    expect(parsePipeArgs(['--pipe', '--json', 'summarize'])).toEqual({
      json: true,
      promptArgs: ['summarize'],
    })
  })
})
