import { expect, it } from 'bun:test'
import { BrowserService } from '../../src/browser/service.js'
import { Tab } from '../../src/browser/tab.js'

it('does not authorize an unowned browser request from its creator page', async () => {
  const service = new BrowserService()
  const sent: string[] = []
  const page = Object.assign(Object.create(Tab.prototype), { targetId: 'creator-frame' }) as Tab
  const internals = service as any
  const allowRequest = internals.allowRequest
  internals.browser = { connection: { send: async (method: string) => { sent.push(method); return {} } } }
  internals.tabContext.set(page, {})
  internals.allowRequest = async () => true

  try {
    const response = internals.answerBrowserRequest({
      requestId: 'unowned-request',
      networkId: 'network-event-not-seen',
      request: { url: 'http://127.0.0.1:43123/probe' },
      resourceType: 'Fetch',
      frameId: page.targetId,
    })
    internals.browser = null
    await response
    expect(sent).toEqual(['Fetch.failRequest'])
  } finally {
    internals.browser = null
    internals.tabContext.clear()
    internals.allowRequest = allowRequest
  }
})
