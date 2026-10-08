// Runnable Linux launcher check: bun tests/bot-dashboard-launch-check.ts
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const directory = await mkdtemp(join(tmpdir(), 'pods-launch-'))
const capture = join(directory, 'browser-url')
let child: ReturnType<typeof Bun.spawn> | undefined
try {
  // Capture the OS opener argument instead of opening a user's browser.
  await writeFile(capture, '')
  await writeFile(join(directory, 'xdg-open'), '#!/bin/sh\numask 077\nprintf "%s" "$1" > "$PODS_CAPTURE"\n', { mode: 0o700 })
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: directory + ':' + process.env.PATH, PODS_CAPTURE: capture }
  delete env.DEEPSEEK_BOTS_TOKEN
  const launched = Bun.spawn([process.execPath, resolve('dist/deepseek.mjs'), 'pods', '--db', join(directory, 'state.db'), 'serve', '--web', '--port', '0'], { env, stdout: 'pipe', stderr: 'pipe' })
  child = launched
  let link = ''
  for (let attempt = 0; attempt < 100 && !link; attempt++) {
    try { link = await readFile(capture, 'utf8') } catch {}
    if (!link) await delay(50)
  }
  assert.ok(link, 'CLI invokes the browser opener')
  const url = new URL(link), token = new URLSearchParams(url.hash.slice(1)).get('token')!
  assert.match(token, /^[a-f0-9]{64}$/)
  assert.equal(url.search, '')
  assert.equal((await fetch(url.origin + '/api/bots')).status, 401)
  const response = await fetch(url.origin + '/api/login', { method: 'POST', headers: { origin: url.origin, 'content-type': 'application/json' }, body: JSON.stringify({ token }) })
  assert.equal(response.status, 200)
  assert.match(response.headers.get('set-cookie')!, /HttpOnly; SameSite=Strict/)
  child.kill('SIGINT')
  assert.equal(await child.exited, 0)
  assert.equal((await new Response(launched.stdout).text()).includes(token), false)
  console.log('Dashboard launch check passed: generated token, browser opener, authenticated session, no token in CLI output.')
} finally {
  if (child && child.exitCode === null) { child.kill('SIGTERM'); await child.exited }
  await rm(directory, { recursive: true, force: true })
}
