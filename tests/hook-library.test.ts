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

  it('preserves lifecycle matcher groups through the settings library', () => {
    const config = {
      SessionStart: [{ matcher: 'resume', hooks: [{ type: 'command' as const, command: 'echo start' }] }],
      Setup: [{ matcher: 'init', hooks: [{ type: 'command' as const, command: 'echo setup' }] }],
      SessionEnd: [{ matcher: 'other', hooks: [{ type: 'command' as const, command: 'echo end' }] }],
      PreCompact: [{ matcher: 'auto', hooks: [{ type: 'command' as const, command: 'echo pre' }] }],
      PostCompact: [{ matcher: 'manual', hooks: [{ type: 'command' as const, command: 'echo post' }] }],
    }
    const restored = unflattenHooks(flattenHooks(config))
    expect(restored).toMatchObject(config)
  })
})
