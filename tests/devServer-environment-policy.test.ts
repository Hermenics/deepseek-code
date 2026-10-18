import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { approvalKey } from '../src/permissions/matcher.js'
import { devServers, launchHash, readLaunchConfigs } from '../src/browser/devServer.js'
import { runDevServer, withLaunchApproval } from '../src/tools/DevServer/DevServer.js'

const AMBIENT_KEY = 'DEEPSEEK_DEVSERVER_AMBIENT_CANARY'
const CONFIGURED_KEY = 'DEEPSEEK_DEVSERVER_CONFIGURED_CANARY'
const OWNER = 'devserver-environment-policy-test'

let root: string

async function writeLaunch(port: number, env: Record<string, string>): Promise<void> {
  await mkdir(join(root, '.deepseek'), { recursive: true })
  await writeFile(join(root, '.deepseek', 'launch.json'), JSON.stringify({
    configurations: [{ name: 'web', runtimeExecutable: process.execPath, runtimeArgs: [], port, env }],
  }))
}

function freePort(): number {
  const server = Bun.serve({ port: 0, fetch: () => new Response('') })
  const port = server.port!
  server.stop(true)
  return port
}

beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'deepseek-devserver-env-')) })
afterEach(async () => {
  await devServers.stopOwnedBy(OWNER)
  await rm(root, { recursive: true, force: true })
})

describe('dev_server environment policy', () => {
  it('binds configured env values into approval while showing only their keys', async () => {
    const firstValue = 'explicit-config-canary-secret'
    const port = freePort()
    await writeLaunch(port, { [CONFIGURED_KEY]: firstValue })

    const firstApproval = await withLaunchApproval(root, { action: 'start', __launch: 'model-value-is-ignored' })
    const firstConfig = (await readLaunchConfigs(root)).configs[0]!
    const firstSummary = String(firstApproval.__command)
    expect(firstApproval.__launch).toBe(launchHash(firstConfig))
    expect(approvalKey('dev_server', firstApproval)).toBe(`dev_server@${launchHash(firstConfig)}`)
    expect(firstSummary).toContain(CONFIGURED_KEY)
    expect(firstSummary).toContain(process.execPath)
    expect(firstSummary).not.toContain(firstValue)

    await writeLaunch(port, { [CONFIGURED_KEY]: 'changed-explicit-config-canary-secret' })
    const changedApproval = await withLaunchApproval(root, { action: 'start' })
    expect(changedApproval.__launch).not.toBe(firstApproval.__launch)
    expect(String(changedApproval.__command)).toContain(CONFIGURED_KEY)
    expect(String(changedApproval.__command)).not.toContain('changed-explicit-config-canary-secret')
  })

  it('passes explicit launch env values but does not inherit ambient canaries', async () => {
    const ambientValue = 'ambient-provider-canary-secret'
    const configuredValue = 'explicit-launch-canary-secret'
    const previousAmbientValue = process.env[AMBIENT_KEY]
    process.env[AMBIENT_KEY] = ambientValue

    try {
      const port = freePort()
      const script = [
        `console.log(JSON.stringify({ ambient: process.env[${JSON.stringify(AMBIENT_KEY)}] ?? null, configured: process.env[${JSON.stringify(CONFIGURED_KEY)}] ?? null }))`,
        `Bun.serve({ port: ${port}, fetch: () => new Response('ok') })`,
      ].join(';')
      await mkdir(join(root, '.deepseek'), { recursive: true })
      await writeFile(join(root, '.deepseek', 'launch.json'), JSON.stringify({
        configurations: [{ name: 'web', runtimeExecutable: process.execPath, runtimeArgs: ['-e', script], port, env: { [CONFIGURED_KEY]: configuredValue } }],
      }))

      const approved = await withLaunchApproval(root, { action: 'start' })
      const result = await runDevServer(approved, { sessionId: OWNER, projectRoot: root, workspacePath: root } as never)
      expect(result).toContain(`ready at http://localhost:${port}`)

      let logs = ''
      for (let attempt = 0; attempt < 30; attempt++) {
        const server = devServers.get(root, 'web')
        if (server) logs = devServers.tail(server, 10)
        if (logs.includes('"configured"')) break
        await Bun.sleep(20)
      }
      expect(logs).toContain('"ambient":null')
      expect(logs).toContain(`"configured":"${configuredValue}"`)
    } finally {
      if (previousAmbientValue === undefined) delete process.env[AMBIENT_KEY]
      else process.env[AMBIENT_KEY] = previousAmbientValue
    }
  }, 20_000)
})
