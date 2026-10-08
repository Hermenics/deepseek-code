// Run: bun tests/bot-cli-output-check.ts
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { execa } from 'execa'
import { podsHelp, formatPodsOutput } from '../src/bots/cli.js'
import { cliStyle } from '../src/utils/cli-style.js'

cliStyle.level = 0

assert.ok(podsHelp().split('\n').length < 20)
assert.match(podsHelp('create'), /--project/)
assert.match(podsHelp('routines'), /test-routine/)
assert.match(podsHelp('all'), /reset-runtime/)
assert.throws(() => podsHelp('missing-command'), /help all/)
assert.match(formatPodsOutput([]), /Nothing here yet/)
assert.match(formatPodsOutput([{ id: 'pod-1', name: 'engineer', projectRoot: '/tmp', enabled: false }]), /engineer.*Paused[\s\S]*pod-1/)
assert.match(formatPodsOutput([{ name: 'Daily', enabled: false, prompt: 'Review the project' }]), /Review the project/)
assert.match(formatPodsOutput({ enabled: false, content: 'hello\nworld' }), /Enabled: No[\s\S]*hello\n  world/)
assert.ok(!formatPodsOutput({ content: '\u001b[31munsafe' }).includes('\u001b'))
assert.equal(formatPodsOutput('before\rafter'), 'beforeafter')
assert.equal(formatPodsOutput('before\r\nafter'), 'before\nafter')
assert.ok(!formatPodsOutput({ 'unsafe\rkey': 'unsafe\rvalue' }).includes('\r'))

const probe = `import terminalChalk from 'chalk'; import { cliStyle } from ${JSON.stringify(new URL('../src/utils/cli-style.ts', import.meta.url).href)}; process.stdout.write(JSON.stringify([cliStyle.level, terminalChalk.level, cliStyle === terminalChalk]))`
const environment = { ...process.env }
for (const key of ['NO_COLOR', 'FORCE_COLOR', 'TERM', 'COLORTERM', 'CI', 'TERM_PROGRAM', 'TERM_PROGRAM_VERSION', 'TEAMCITY_VERSION', 'TF_BUILD', 'AGENT_NAME']) delete environment[key]
for (const [env, level] of [
  [{}, 0],
  [{ TERM: 'xterm' }, 1],
  [{ TERM: 'xterm-256color' }, 2],
  [{ COLORTERM: 'truecolor' }, 3],
  [{ COLORTERM: '24bit' }, 3],
  [{ COLORTERM: 'ansi256' }, 2],
  [{ FORCE_COLOR: '1' }, 1],
  [{ FORCE_COLOR: '2' }, 2],
  [{ FORCE_COLOR: '3' }, 3],
  [{ FORCE_COLOR: '0', COLORTERM: 'truecolor' }, 0],
  [{ FORCE_COLOR: 'false', COLORTERM: 'truecolor' }, 0],
  [{ NO_COLOR: '', FORCE_COLOR: '3', COLORTERM: 'truecolor' }, 0],
  [{ TERM: 'dumb', FORCE_COLOR: '3' }, 0],
] as const) {
  const result = spawnSync(process.execPath, ['--eval', probe], { env: { ...environment, ...env }, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  const [actualLevel, terminalLevel, shared] = JSON.parse(result.stdout)
  assert.equal(actualLevel, terminalLevel, JSON.stringify(env))
  assert.equal(shared, true)
  if ('FORCE_COLOR' in env && level > 0) assert.ok(actualLevel >= level && actualLevel <= 3, JSON.stringify(env))
  else assert.equal(actualLevel, level, JSON.stringify(env))
}
const entrypoint = await Bun.file(new URL('../src/entrypoints/cli.tsx', import.meta.url)).text()
const explicitLoop = entrypoint.match(/for \(const \{ pm, result \} of results\) if \(result.exitCode !== 0\)[^\n]+/)![0]
const interactiveLoop = entrypoint.match(/for \(const \{ result \} of results\) \{[\s\S]*?\n      \}/)![0]
const failures = [
  await execa('__missing_pods_update_command__', { reject: false }),
  await execa(process.execPath, ['--eval', 'process.kill(process.pid, "SIGTERM")'], { reject: false }),
]
for (const result of failures) {
  assert.equal(result.stdout, '')
  assert.equal(result.stderr, '')
  assert.ok(result.shortMessage)
  for (const loop of [explicitLoop, interactiveLoop]) {
    let stderr = ''
    new Function('results', 'process', loop)([{ pm: 'npm', result }], { stdout: { write: () => {} }, stderr: { write: (text: string) => { stderr += text } } })
    assert.ok(stderr.includes(result.shortMessage))
  }
}
console.log('Pods CLI output check passed.')
