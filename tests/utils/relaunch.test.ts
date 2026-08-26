import { describe, expect, it } from 'bun:test'
import { getCurrentInvocation } from '../../src/utils/relaunch.js'

describe('relaunch invocation', () => {
  it('preserves the runtime, entrypoint, and original arguments', () => {
    expect(getCurrentInvocation(['agent', 'reviewer', 'fix the bug'], '/opt/deepseek.mjs', '/usr/bin/bun')).toEqual([
      '/usr/bin/bun',
      '/opt/deepseek.mjs',
      'agent',
      'reviewer',
      'fix the bug',
    ])
  })

  it('preserves flags used by the original interactive invocation', () => {
    expect(getCurrentInvocation(['--resume', 'abc123'], '/opt/deepseek.mjs', '/usr/bin/bun')).toEqual([
      '/usr/bin/bun',
      '/opt/deepseek.mjs',
      '--resume',
      'abc123',
    ])
  })

  it('rejects a missing entrypoint instead of launching an unrelated command', () => {
    expect(() => getCurrentInvocation([], '', '/usr/bin/bun')).toThrow('without an entrypoint')
  })
})
