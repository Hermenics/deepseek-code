import { describe, expect, it } from 'bun:test'
import { existsSync } from 'node:fs'
import { CdpConnection, pipeTransport, type CdpTransport } from '../../src/browser/cdp.js'
import { chromeArgs, launchBrowser } from '../../src/browser/launcher.js'
import { findChromium } from '../../src/utils/platform.js'

/** In-memory transport: records what the client sent and lets the test play the browser. */
function fakeTransport() {
  const sent: Array<{ id: number; method: string; params: Record<string, unknown>; sessionId?: string }> = []
  let deliver: (message: string) => void = () => {}
  let hangUp: (reason: string) => void = () => {}
  const transport: CdpTransport = {
    send: message => { sent.push(JSON.parse(message)) },
    start: (onMessage, onClose) => { deliver = onMessage; hangUp = onClose },
    close: () => hangUp('closed by client'),
  }
  return { transport, sent, reply: (message: object) => deliver(JSON.stringify(message)), raw: (text: string) => deliver(text), hangUp: (reason: string) => hangUp(reason) }
}

describe('CdpConnection', () => {
  it('correlates responses by id even when they arrive out of order', async () => {
    const fake = fakeTransport()
    const cdp = new CdpConnection(fake.transport)
    const first = cdp.send('Page.navigate', { url: 'http://localhost:3000' })
    const second = cdp.send('Runtime.evaluate', { expression: '1' }, 'S1')
    expect(fake.sent[1]).toEqual({ id: 2, method: 'Runtime.evaluate', params: { expression: '1' }, sessionId: 'S1' })
    fake.reply({ id: 2, result: { value: 1 } })
    fake.reply({ id: 1, result: { frameId: 'F' } })
    expect(await second).toEqual({ value: 1 })
    expect(await first).toEqual({ frameId: 'F' })
  })

  it('rejects protocol errors and timeouts, and ignores malformed frames', async () => {
    const fake = fakeTransport()
    const cdp = new CdpConnection(fake.transport)
    const failing = cdp.send('DOM.focus', { backendNodeId: 9 })
    fake.raw('{not json')
    fake.reply({ id: 1, error: { message: 'No node with given id found' } })
    await expect(failing).rejects.toThrow('No node with given id found')
    await expect(cdp.send('Page.reload', {}, undefined, 20)).rejects.toThrow('Page.reload timed out after 20ms')
  })

  it('dispatches events with their session and stops after unsubscribe', () => {
    const fake = fakeTransport()
    const cdp = new CdpConnection(fake.transport)
    const seen: Array<[unknown, string | undefined]> = []
    const off = cdp.on('Runtime.consoleAPICalled', (params, sessionId) => seen.push([params.type, sessionId]))
    fake.reply({ method: 'Runtime.consoleAPICalled', params: { type: 'error' }, sessionId: 'S1' })
    off()
    fake.reply({ method: 'Runtime.consoleAPICalled', params: { type: 'log' } })
    expect(seen).toEqual([['error', 'S1']])
  })

  it('fails every pending command when the browser goes away, and refuses new ones', async () => {
    const fake = fakeTransport()
    const cdp = new CdpConnection(fake.transport)
    const pending = cdp.send('Page.captureScreenshot')
    fake.hangUp('browser pipe ended')
    await expect(pending).rejects.toThrow('Browser connection closed: browser pipe ended')
    await expect(cdp.send('Page.reload')).rejects.toThrow('Browser connection closed')
    expect(cdp.closed).toBe('browser pipe ended')
  })
})

describe('pipeTransport', () => {
  // Chrome's fd 3/4 debugging pipe is POSIX; Windows uses a different handle-based protocol.
  it.skipIf(process.platform === 'win32')('frames messages on NUL across a real pipe, keeping multi-byte text intact', async () => {
    const proc = Bun.spawn(['sh', '-c', 'cat <&3 >&4'], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] })
    const received: string[] = []
    const transport = pipeTransport(proc.stdio[3] as number, proc.stdio[4] as number)
    const done = new Promise<void>(resolve => transport.start(message => { received.push(message); if (received.length === 3) resolve() }, () => resolve()))
    for (const text of ['{"a":"ação"}', '{"b":"🌐 localhost"}', '{"c":"' + 'x'.repeat(100_000) + '"}']) transport.send(text)
    await Promise.race([done, Bun.sleep(3000)])
    transport.close()
    proc.kill()
    expect(received.slice(0, 2)).toEqual(['{"a":"ação"}', '{"b":"🌐 localhost"}'])
    expect(received[2]).toHaveLength(100_008)
  })
})

describe('launcher', () => {
  it('never exposes a TCP debugging port and only goes headless when hidden', () => {
    expect(chromeArgs('/tmp/p', false)).toContain('--headless')
    expect(chromeArgs('/tmp/p', true)).not.toContain('--headless')
    expect(chromeArgs('/tmp/p', false).some(arg => arg.startsWith('--remote-debugging-port'))).toBe(false)
  })

  it.skipIf(process.platform !== 'win32')('explains that browser automation is not supported on Windows', () => {
    expect(() => launchBrowser()).toThrow('The browser tool is not supported on Windows yet.')
  })

  it.skipIf(!findChromium() || process.platform === 'win32')('starts a real browser over the pipe and leaves nothing behind when killed', async () => {
    const browser = launchBrowser()
    const version = await browser.connection.send<{ product: string }>('Browser.getVersion')
    expect(version.product).toMatch(/Chrome|Chromium|Edg|Brave/)
    const profile = (await Bun.$`ps -o args= -p ${browser.pid}`.quiet().nothrow()).stdout.toString().match(/--user-data-dir=(\S+)/)?.[1]
    browser.kill()
    expect(await Promise.race([browser.exited.then(() => 'exited'), Bun.sleep(5000).then(() => 'timeout')])).toBe('exited')
    expect(profile && existsSync(profile)).toBeFalsy()
    await expect(browser.connection.send('Browser.getVersion')).rejects.toThrow('closed')
  }, 30_000)
})
