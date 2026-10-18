import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { OrchestratorSession } from '../src/orchestration/OrchestratorSession.js'
import { Shell, runProjectVerificationReadOnly } from '../src/tools/Shell/Shell.js'
import { runSubagentStatusLine } from '../src/ui/App.js'
import { sandboxAvailable } from '../src/utils/platform.js'

const credentialEnvironmentNames = [
  'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'AWS_PROFILE', 'AWS_REGION',
  'GOOGLE_APPLICATION_CREDENTIALS', 'CLOUDSDK_AUTH_ACCESS_TOKEN',
  'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET', 'AZURE_TENANT_ID', 'AZURE_SUBSCRIPTION_ID', 'ARM_CLIENT_SECRET',
  'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'DEEPSEEK_API_KEY', 'CUSTOM_PROVIDER_CANARY',
]
const credentialCanary = 'shell-child-provider-credential-canary-4f81'
const roots: string[] = []
const sessions: OrchestratorSession[] = []
const originalEnvironment = new Map<string, string | undefined>()

afterEach(async () => {
  for (const session of sessions.splice(0)) {
    await session.shutdown('shell child environment policy test cleanup')
    await session.registry.awaitIdle()
  }
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
  for (const [key, value] of originalEnvironment) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  originalEnvironment.clear()
})

async function createRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix))
  roots.push(root)
  return root
}

function installCredentialCanaries(): void {
  for (const key of credentialEnvironmentNames) {
    if (!originalEnvironment.has(key)) originalEnvironment.set(key, process.env[key])
    process.env[key] = credentialCanary
  }
}

function shellCredentialProbe(): string {
  const checks = credentialEnvironmentNames.map(key => `[ -n "\${${key}-}" ]`).join(' || ')
  return `if ${checks}; then printf '%s' 'provider-env-leaked'; exit 23; else printf '%s' 'provider-env-clean'; fi`
}

function quoteCommandArgument(value: string): string {
  if (process.platform === 'win32') return `"${value.replaceAll('"', '\\"')}"`
  return `'${value.replaceAll("'", "'\\''")}'`
}

const sandboxTest = it.skipIf(!sandboxAvailable())

describe('shell child environment policy', () => {
  sandboxTest('foreground Shell commands do not inherit ambient provider credentials but keep command-local assignments', async () => {
    const root = await createRoot('deepseek-shell-env-foreground-')
    installCredentialCanaries()

    const result = await Shell.execute({ command: shellCredentialProbe() }, {
      sessionId: 'shell-env-foreground', workspacePath: root, projectRoot: root,
      permissionProfile: 'coordinator-integrator',
    })
    expect(result).toContain('provider-env-clean')
    expect(result).not.toContain('provider-env-leaked')

    const explicit = await Shell.execute({ command: `AWS_PROFILE=explicit-user-profile sh -c 'printf "%s" "$AWS_PROFILE"'` }, {
      sessionId: 'shell-env-explicit-command-variable', workspacePath: root, projectRoot: root,
      permissionProfile: 'coordinator-integrator',
    })
    expect(explicit).toContain('explicit-user-profile')
  })

  sandboxTest('background Shell commands stay scrubbed through the detached supervisor path', async () => {
    const root = await createRoot('deepseek-shell-env-background-')
    installCredentialCanaries()
    const session = new OrchestratorSession({ projectRoot: root, logFile: null, snapshotFile: null })
    sessions.push(session)
    const context = Object.assign(session.toolContext({
      workspacePath: root, permissionProfile: 'coordinator-integrator', dangerousOperationApproved: true,
    }), { shellOutputRoot: root, shellOutputRecoveryRoot: join(root, '.deepseek-code', 'shell-output-recovery') })

    const handle = JSON.parse(await Shell.execute({ command: shellCredentialProbe(), background: true }, context)) as { taskId: string }
    const result = await session.registry.awaitResult<string>(handle.taskId)
    expect(result.status).toBe('done')
    expect(result.value).toContain('provider-env-clean')
    expect(result.value).not.toContain('provider-env-leaked')
  })

  sandboxTest('verification test processes do not inherit ambient provider credentials', async () => {
    const root = await createRoot('deepseek-shell-env-verification-')
    installCredentialCanaries()
    await writeFile(join(root, 'package.json'), JSON.stringify({ scripts: { test: 'bun test' } }))
    await writeFile(join(root, 'bun.lock'), '{}')
    const testSource = [
      "import { expect, it } from 'bun:test'",
      `const credentialNames = ${JSON.stringify(credentialEnvironmentNames)}`,
      "it('does not inherit host provider credentials', () => {",
      '  const clean = credentialNames.every(name => process.env[name] === undefined)',
      '  expect(clean).toBe(true)',
      '})',
    ].join('\n')
    await writeFile(join(root, 'environment.test.ts'), testSource)

    const result = await runProjectVerificationReadOnly({ command: 'bun', args: ['run', 'test'], display: 'bun run test' }, root)
    expect(result.status).toBe('passed')
    expect(result.testCount).toBe(1)
    expect(result.output).not.toContain(credentialCanary)
  })

  it('keeps the status-line stdin contract while omitting ambient provider credentials', async () => {
    const root = await createRoot('deepseek-shell-env-status-line-')
    installCredentialCanaries()
    const names = `[${credentialEnvironmentNames.map(name => `'${name}'`).join(',')}]`
    const source = `let input='';process.stdin.on('data',chunk=>input+=chunk);process.stdin.on('end',()=>{const keys=${names};const leaked=keys.some(key=>process.env[key]!==undefined);const content=leaked?'provider-env-leaked':input.trim()?'provider-env-clean':'statusline-input-missing';process.stdout.write(JSON.stringify({id:'environment-check',content})+'\\n')})`
    const command = `${quoteCommandArgument(process.execPath)} -e ${quoteCommandArgument(source)}`
    const decorations = await runSubagentStatusLine(
      { type: 'command', command },
      { columns: 80, tasks: [{ id: 'environment-check', status: 'running' }] },
      { cwd: root, trusted: true },
    )
    expect(decorations.get('environment-check')).toBe('provider-env-clean')
  })
})
