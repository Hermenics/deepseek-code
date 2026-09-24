import { describe, expect, it, spyOn } from 'bun:test'
import { getCurrentInvocation, relaunchCurrentInvocation } from '../../src/utils/relaunch.js'

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

  it('keeps the parent alive until the replacement exits', async () => {
    let finish!: (code: number) => void
    const exited = new Promise<number>(resolve => { finish = resolve })
    const spawn = spyOn(Bun, 'spawn').mockReturnValue({ exited } as ReturnType<typeof Bun.spawn>)
    try {
      let settled = false
      const relaunch = relaunchCurrentInvocation(['--resume', 'abc123']).then(code => {
        settled = true
        return code
      })
      await Promise.resolve()
      expect(settled).toBe(false)
      expect(spawn).toHaveBeenCalledWith(
        getCurrentInvocation(['--resume', 'abc123']),
        expect.objectContaining({ stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' }),
      )
      finish(23)
      expect(await relaunch).toBe(23)
    } finally {
      spawn.mockRestore()
    }
  })
})
