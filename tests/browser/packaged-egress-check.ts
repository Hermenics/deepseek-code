// Checks the actual helper shipped in an installed package, not a source import.
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { request } from 'node:http'
import { createEgressCertificate } from '../../src/browser/egress.js'
import { scrubbedEnv } from '../../src/utils/platform.js'

const helper = process.argv[2]
assert.ok(helper && existsSync(helper), 'Installed network helper is missing')
const identity = await createEgressCertificate()
let hits = 0, forwardedCredential = false
const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(req) {
  hits++; forwardedCredential ||= req.headers.has('proxy-authorization')
  return new Response('packaged upstream')
} })
const target = `http://localhost:${server.port}`
let ready: (value: { url: string; username: string; password: string }) => void = () => {}, failed: (error: Error) => void = () => {}
const initialized = new Promise<{ url: string; username: string; password: string }>((done, fail) => { ready = done; failed = fail })
const node = Bun.which('node')!
const child = Bun.spawn([node, helper], { env: scrubbedEnv(), stdin: 'ignore', stdout: 'ignore', stderr: 'ignore', serialization: 'json', ipc(message, process) {
  const value = message as { type?: string; id?: number; url: string; username: string; password: string }
  if (value.type === 'ready') ready(value)
  if (value.type === 'error') failed(Error('Installed network helper initialization failed'))
  if (value.type === 'authorize') process.send({ type: 'reply', id: value.id, value: new URL(value.url).origin === target })
} })
const timer = setTimeout(() => failed(Error('Installed network helper timed out')), 5000)
void child.exited.then(() => failed(Error('Installed network helper exited')))
child.send({ type: 'init', key: identity.key, cert: identity.cert, spki: identity.spki })
try {
  const proxy = await initialized
  const fetch = (url: string, authorized = true) => new Promise<{ status: number; text: string }>((resolve, reject) => {
    const outgoing = request(proxy.url, { path: url, headers: authorized ? { 'proxy-authorization': `Basic ${Buffer.from(`${proxy.username}:${proxy.password}`).toString('base64')}` } : {} }, incoming => {
      let text = ''
      incoming.on('data', value => { text += value })
      incoming.on('end', () => resolve({ status: incoming.statusCode!, text }))
      incoming.on('error', reject)
    })
    outgoing.setTimeout(5000, () => outgoing.destroy(Error('Installed helper request timed out')))
    outgoing.on('error', reject); outgoing.end()
  })
  assert.equal((await fetch(target, false)).status, 407)
  assert.equal(hits, 0)
  assert.deepEqual(await fetch(target), { status: 200, text: 'packaged upstream' })
  assert.equal(hits, 1); assert.equal(forwardedCredential, false)
  assert.equal((await fetch(`http://0.0.0.0:${server.port}/`)).status, 502)
  assert.equal(hits, 1)
  console.log('Installed network helper passed: authenticated HTTP relay, blocked address and credential stripping')
} finally { clearTimeout(timer); child.kill(); await child.exited; server.stop(true) }
