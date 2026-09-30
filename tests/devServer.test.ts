import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { devServers, launchHash, portOpen, readLaunchConfigs } from '../src/browser/devServer.js'
import { runDevServer, withLaunchApproval } from '../src/tools/DevServer/DevServer.js'
import { assessRisk } from '../src/permissions/risk.js'
import { approvalKey, resolvePermission } from '../src/permissions/matcher.js'

let root: string

async function writeLaunch(dir: '.deepseek' | '.claude', configurations: unknown[]): Promise<void> {
  await mkdir(join(root, dir), { recursive: true })
  await writeFile(join(root, dir, 'launch.json'), JSON.stringify({ version: '0.0.1', configurations }))
}

function freePort(): number {
  const server = Bun.serve({ port: 0, fetch: () => new Response('') })
  const port = server.port!
  server.stop(true)
  return port
}

beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'deepseek-devserver-')) })
afterEach(async () => {
  await devServers.stopOwnedBy('test')
  await rm(root, { recursive: true, force: true })
})

describe('launch.json', () => {
  it('prefers .deepseek over .claude and resolves cwd inside the project', async () => {
    await writeLaunch('.claude', [{ name: 'web', runtimeExecutable: 'npm', runtimeArgs: ['run', 'dev'], port: 3000 }])
    expect((await readLaunchConfigs(root)).configs[0]).toMatchObject({ name: 'web', source: '.claude/launch.json', cwd: root })
    await writeLaunch('.deepseek', [{ name: 'api', runtimeExecutable: 'bun', port: 4000, cwd: 'server' }])
    expect((await readLaunchConfigs(root)).configs[0]).toMatchObject({ name: 'api', runtimeArgs: [], cwd: join(root, 'server') })
  })

  it('rejects malformed entries instead of guessing', async () => {
    await writeLaunch('.deepseek', [{ name: 'x', runtimeExecutable: 'bun', port: 3000, cwd: '../elsewhere' }])
    expect((await readLaunchConfigs(root)).error).toContain('cwd must stay inside the project')
    await writeLaunch('.deepseek', [{ name: 'x', runtimeExecutable: 'bun', port: 70000 }])
    expect((await readLaunchConfigs(root)).error).toContain('port must be 1-65535')
    await writeLaunch('.deepseek', [{ name: 'x', runtimeExecutable: 'bun', runtimeArgs: 'dev', port: 3000 }])
    expect((await readLaunchConfigs(root)).error).toContain('runtimeArgs')
  })
})

describe('dev_server permissions', () => {
  it('asks for every start, bound to the exact entry; reads need no prompt', async () => {
    await writeLaunch('.claude', [{ name: 'web', runtimeExecutable: 'npm', runtimeArgs: ['run', 'dev'], port: 3000 }])
    const args = await withLaunchApproval(root, { action: 'start', __launch: 'forged-by-model' })
    const hash = launchHash((await readLaunchConfigs(root)).configs[0]!)
    expect(args.__launch).toBe(hash)
    expect(args.__command).toContain('npm run dev')
    expect(approvalKey('dev_server', args)).toBe(`dev_server@${hash}`)
    expect(assessRisk('dev_server', args, { isSubAgent: false, recentWriteCount: 0, config: {} })?.level).toBe('high')
    expect(resolvePermission(undefined, 'dev_server', args)).toBe('ask')
    expect(resolvePermission(undefined, 'dev_server', { action: 'logs', name: 'web' })).toBe('allow')

    await writeLaunch('.claude', [{ name: 'web', runtimeExecutable: 'npm', runtimeArgs: ['run', 'evil'], port: 3000 }])
    expect((await withLaunchApproval(root, { action: 'start' })).__launch).not.toBe(hash)
  })

  it('refuses to start an entry that changed after approval', async () => {
    await writeLaunch('.deepseek', [{ name: 'web', runtimeExecutable: 'true', port: freePort() }])
    const approved = await withLaunchApproval(root, { action: 'start' })
    await writeLaunch('.deepseek', [{ name: 'web', runtimeExecutable: 'rm', runtimeArgs: ['-rf', '/tmp/x'], port: 3000 }])
    expect(await runDevServer(approved, { sessionId: 'test', projectRoot: root, workspacePath: root } as never)).toContain('changed after it was approved')
  })
})

describe('dev_server lifecycle', () => {
  it('starts, waits for the port, keeps logs, and stops the whole process group', async () => {
    const port = freePort()
    // The server is a grandchild behind `sh -c`: stopping must reach it through the process group.
    const script = `Bun.serve({ port: ${port}, fetch: () => new Response('ok') }); console.log('listening on ${port}')`
    await writeLaunch('.deepseek', [{ name: 'web', runtimeExecutable: 'sh', runtimeArgs: ['-c', `${process.execPath} -e "${script}" & wait`], port }])
    const context = { sessionId: 'test', projectRoot: root, workspacePath: root } as never
    const started = await runDevServer(await withLaunchApproval(root, { action: 'start' }), context)
    expect(started).toContain(`ready at http://localhost:${port}`)
    expect(await runDevServer(await withLaunchApproval(root, { action: 'start' }), context)).toContain('already running')
    await Bun.sleep(100)
    expect(await runDevServer({ action: 'logs', name: 'web' }, context)).toContain(`listening on ${port}`)
    expect(await runDevServer({ action: 'list' }, context)).toContain('running (pid')

    expect(await runDevServer({ action: 'stop', name: 'web' }, context)).toBe('Stopped web.')
    await Bun.sleep(200)
    expect(await portOpen(port)).toBe(false)
  }, 20_000)

  it('reports an early exit with its output, and does not start over a busy port', async () => {
    const busy = Bun.serve({ port: 0, fetch: () => new Response('') })
    try {
      await writeLaunch('.deepseek', [
        { name: 'broken', runtimeExecutable: 'sh', runtimeArgs: ['-c', 'echo boom >&2; exit 3'], port: freePort() },
        { name: 'taken', runtimeExecutable: 'true', port: busy.port },
      ])
      const context = { sessionId: 'test', projectRoot: root, workspacePath: root } as never
      const broken = await runDevServer(await withLaunchApproval(root, { action: 'start', name: 'broken' }), context)
      expect(broken).toContain('exited with code 3')
      expect(broken).toContain('[err] boom')
      expect(await runDevServer(await withLaunchApproval(root, { action: 'start', name: 'taken' }), context)).toContain('already in use')
    } finally {
      busy.stop(true)
    }
  }, 20_000)

  it('keeps subagents out', async () => {
    expect(await runDevServer({ action: 'list' }, { sessionId: 'test', taskId: 't1', projectRoot: root } as never)).toContain('subagents cannot')
  })
})
