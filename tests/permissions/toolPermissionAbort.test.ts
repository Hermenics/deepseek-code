import { expect, it } from 'bun:test'
import type { ToolPermissionHandler, ToolPermissionRequest } from '../../src/agent/agent.js'
import { bindToolPermissionPrompt, type ToolPermissionState } from '../../src/ui/App.js'

it('removes a permission prompt when its active turn is aborted', async () => {
  let handler: ToolPermissionHandler | null = null
  const published: (ToolPermissionState | null)[] = []
  const unbind = bindToolPermissionPrompt({ setToolPermissionHandler: value => { handler = value } }, state => { published.push(state) })
  const controller = new AbortController()
  const request: ToolPermissionRequest = { toolName: 'shell', args: { command: 'true' }, reason: 'permission' }

  try {
    const decision = handler!(request, controller.signal)
    expect(published.at(-1)?.request).toEqual(request)

    controller.abort()

    expect(await decision).toBe('reject')
    expect(published.at(-1)).toBeNull()
  } finally {
    unbind()
  }
})
