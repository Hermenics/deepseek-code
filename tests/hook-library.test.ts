import { describe, expect, it } from 'bun:test'
import { flattenHooks, unflattenHooks } from '../src/ui/setup/HookLibrary.js'

describe('hook library persistence', () => {
  it('preserves matcher identity and disabled state through editing', () => {
    const config = {
      PreToolUse: [{
        id: 'matcher-original', matcher: 'shell', enabled: false,
        hooks: [{ id: 'hook-original', type: 'command' as const, command: 'echo ok', enabled: true }],
      }],
    }
    expect(unflattenHooks(flattenHooks(config)).PreToolUse?.[0]).toEqual(config.PreToolUse[0])
  })
})
