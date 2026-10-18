import { expect, it } from 'bun:test'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { signalProcessGroup, signalProcessGroupId } from '../src/utils/processGroup.js'

it('rejects process-group IDs that could target the caller or init', () => {
  expect(signalProcessGroupId(0, 'SIGTERM')).toBe(false)
  expect(signalProcessGroupId(1, 'SIGTERM')).toBe(false)
  expect(signalProcessGroupId(1.5, 'SIGTERM')).toBe(false)
})

it.skipIf(process.platform !== 'linux')('falls back to the child when no matching owned group exists', async () => {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
  const spawned = once(child, 'spawn')
  const exited = once(child, 'exit')
  try {
    await spawned
    signalProcessGroup(child, 'SIGTERM')
    const [, signal] = await exited
    expect(signal).toBe('SIGTERM')
  } finally {
    signalProcessGroup(child, 'SIGKILL')
    await exited
  }
})

it.skipIf(process.platform !== 'linux')('signals descendants after the detached group leader exits', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'deepseek-process-group-'))
  const ready = join(directory, 'ready')
  const term = join(directory, 'term')
  const late = join(directory, 'late')
  const descendant = `const fs=require('node:fs');process.on('SIGTERM',()=>{fs.writeFileSync(${JSON.stringify(term)},'term');setTimeout(()=>fs.writeFileSync(${JSON.stringify(late)},'late'),600)});fs.writeFileSync(${JSON.stringify(ready)},'ready');setInterval(()=>{},1000)`
  const leader = `const {spawn}=require('node:child_process');const fs=require('node:fs');spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:'ignore'});const poll=setInterval(()=>{if(fs.existsSync(${JSON.stringify(ready)})){clearInterval(poll);process.stdout.write('ready')}},5);setInterval(()=>{},1000)`
  const child = spawn(process.execPath, ['-e', leader], { detached: true, stdio: ['ignore', 'pipe', 'ignore'] })
  const exited = once(child, 'exit')
  try {
    const deadline = Date.now() + 5_000
    while (!existsSync(ready) && Date.now() < deadline) await Bun.sleep(10)
    expect(existsSync(ready)).toBe(true)

    signalProcessGroup(child, 'SIGTERM')
    const [, signal] = await Promise.race([
      exited,
      Bun.sleep(2_000).then(() => { throw new Error('Detached group leader did not stop after SIGTERM') }),
    ])
    expect(signal).toBe('SIGTERM')
    expect(existsSync(term)).toBe(true)

    signalProcessGroup(child, 'SIGKILL')
    await Bun.sleep(750)
    expect(existsSync(late)).toBe(false)
  } finally {
    if (child.pid) {
      try { process.kill(-child.pid, 'SIGKILL') } catch { /* The owned group may already have exited. */ }
    }
    signalProcessGroup(child, 'SIGKILL')
    await Promise.race([exited, Bun.sleep(250)])
    await rm(directory, { recursive: true, force: true })
  }
})
