// Explicit security gate, run with: bun tests/browser/socket-network-check.ts
// Keep this separate from the ordinary regressions while socket containment is
// unresolved. A successful CDP command is not proof that it blocks a handshake.
import assert from 'node:assert/strict'
import { BrowserService, contextKey } from '../../src/browser/service.js'
import { classifyUrl } from '../../src/browser/policy.js'

let hits = 0
const server = Bun.serve({
  hostname: '127.0.0.1', port: 0,
  fetch(request, server) {
    if (new URL(request.url).pathname === '/socket' && server.upgrade(request)) return
    return new Response('<!doctype html><title>Socket containment fixture</title>', { headers: { 'content-type': 'text/html' } })
  },
  websocket: { open(socket) { hits++; socket.close() }, message() {} },
})
const base = `http://localhost:${server.port}`
const destination = `ws://0.0.0.0:${server.port}/socket`
const service = new BrowserService(), key = contextKey('socket-network-check')
try {
  assert.equal((await classifyUrl(destination.replace(/^ws:/, 'http:'))).kind, 'blocked')
  // Positive control: the fixture really accepts this local address. Nothing
  // reaches a real LAN, public endpoint or third-party service.
  await new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(destination)
    const timer = setTimeout(() => { socket.close(); reject(Error('Socket fixture unavailable')) }, 2000)
    socket.onopen = () => { clearTimeout(timer); socket.close(); resolve() }
    socket.onerror = () => { clearTimeout(timer); reject(Error('Socket fixture failed')) }
  })
  assert.equal(hits, 1); hits = 0
  await service.withTab(key, async () => {})
  service.approve(key, base)
  const result = await service.withTab(key, async tab => {
    await tab.navigate(base)
    // Even the strongest wildcard setting must be validated against actual
    // traffic rather than being mistaken for a network boundary.
    await tab.cdp.send('Network.setBlockedURLs', { urls: ['ws://*', 'wss://*'] }, tab.sessionId)
    const response = await tab.cdp.send<{ result: { value?: string }; exceptionDetails?: unknown }>('Runtime.evaluate', {
      expression: `new Promise(resolve => {
        const socket = new WebSocket(${JSON.stringify(destination)});
        const timer = setTimeout(() => { socket.close(); resolve('timeout'); }, 3000);
        socket.onopen = () => { clearTimeout(timer); socket.close(); resolve('opened'); };
        socket.onerror = () => { clearTimeout(timer); resolve('blocked'); };
      })`, awaitPromise: true, returnByValue: true,
    }, tab.sessionId)
    assert.equal(response.exceptionDetails, undefined)
    return response.result.value
  })
  assert.equal(result, 'blocked', `Socket gate failed: browser=${result}; server handshakes=${hits}`)
  assert.equal(hits, 0)
  console.log('Socket network gate passed: zero blocked-address handshakes')
} finally {
  await service.shutdown(); await service.whenClosed(); server.stop(true)
}
