import { describe, expect, it } from 'bun:test'
import { exportPlaywright, stepFor } from '../../src/browser/record.js'
import { Tab } from '../../src/browser/tab.js'
import type { CdpConnection } from '../../src/browser/cdp.js'

describe('browser recording and initial gate', () => {
  it('preserves negative URL postconditions in recordings and exports', () => {
    const step = stepFor('expect', { url: '/pending', gone: true })!
    expect(step).toMatchObject({ action: 'expect', url: '/pending', gone: true })
    expect(exportPlaywright([step])).toContain('expect(page).not.toHaveURL')
  })
  it('installs a gate for every resource while the new target is still paused', async () => {
    const calls: Array<{ method: string; args: any }> = []
    const cdp = { on: () => () => {}, async send(method: string, args: object) { calls.push({ method, args }); return {} } } as unknown as CdpConnection
    const tab = new Tab(cdp, 'session', 'target', async () => true)
    await tab.setup()
    expect(calls).toEqual([{ method: 'Fetch.enable', args: { handleAuthRequests: true, patterns: [{ urlPattern: '*', requestStage: 'Request' }] } }])
    tab.dispose()
  })
})
