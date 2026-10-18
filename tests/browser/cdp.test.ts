import { describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, writeFileSync, chmodSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
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
    expect(chromeArgs('/tmp/p', false)).toContain('--disable-extensions')
    expect(chromeArgs('/tmp/p', false)).toContain('--disable-component-extensions-with-background-pages')
    const protectedArgs = chromeArgs('/tmp/p', false, { proxyServer: 'http://127.0.0.1:12345', proxyBypassList: '<-loopback>', certificateSPKI: 'private-public-key-hash' })
    expect(protectedArgs).toContain('--enable-automation')
    expect(protectedArgs).toContain('--proxy-server=http://127.0.0.1:12345')
    expect(protectedArgs).toContain('--proxy-bypass-list=<-loopback>')
    expect(protectedArgs).toContain('--ignore-certificate-errors-spki-list=private-public-key-hash')
    expect(protectedArgs).not.toContain('--ignore-certificate-errors')
    expect(protectedArgs.some(arg => arg.includes('direct://'))).toBe(false)
    expect(protectedArgs).toContain('--disable-quic')
    expect(protectedArgs).toContain('--force-webrtc-ip-handling-policy=disable_non_proxied_udp')
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


it.skipIf(process.platform !== 'linux')('terminates owned browser helpers before leaving a throwaway profile behind', async () => {
  const root = mkdtempSync(join(tmpdir(), 'deepseek-browser-helper-'))
  const ready = join(root, 'helper-ready.json')
  const executable = join(root, 'fake-browser')
  const helper = `const fs = require('node:fs'); const profile = process.argv[1];
    const write = () => { fs.mkdirSync(profile, {recursive:true}); fs.writeFileSync(profile + '/helper-state', 'owned helper'); };
    write(); fs.writeFileSync(${JSON.stringify(ready)}, JSON.stringify({pid:process.pid,profile})); setInterval(write, 2);`
  writeFileSync(executable, `#!${process.execPath}
const {spawn} = require('node:child_process'); const profile = process.argv.find(arg => arg.startsWith('--user-data-dir=')).slice('--user-data-dir='.length); spawn(process.execPath, ['-e', ${JSON.stringify(helper)}, profile], {stdio:'ignore'}); setInterval(()=>{},10000);`)
  chmodSync(executable, 0o700)
  const browser = launchBrowser({ executablePath: executable })
  let helperPid: number | undefined
  let helperProfile: string | undefined
  const liveOwnedHelper = () => {
    if (!helperPid) return false
    try {
      const stat = readFileSync(`/proc/${helperPid}/stat`, 'utf8')
      const state = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[0]
      return state !== 'Z' && state !== 'X' && readFileSync(`/proc/${helperPid}/cmdline`, 'utf8').includes(root)
    } catch { return false }
  }
  try {
    const deadline = Date.now() + 2000
    while (!existsSync(ready) && Date.now() < deadline) await Bun.sleep(5)
    expect(existsSync(ready)).toBe(true)
    const helperState = JSON.parse(readFileSync(ready, 'utf8'))
    helperPid = helperState.pid
    helperProfile = helperState.profile
    expect(liveOwnedHelper()).toBe(true)
    browser.kill()
    await browser.exited
    const stopped = Date.now() + 1000
    while (liveOwnedHelper() && Date.now() < stopped) await Bun.sleep(5)
    expect(liveOwnedHelper()).toBe(false)
  } finally {
    browser.kill()
    await browser.exited
    if (liveOwnedHelper()) process.kill(helperPid!, 'SIGKILL')
    const deadline = Date.now() + 1000
    while (liveOwnedHelper() && Date.now() < deadline) await Bun.sleep(5)
    if (helperProfile) rmSync(helperProfile, { recursive: true, force: true })
    rmSync(root, { recursive: true, force: true })
  }
})
