import { expect, it } from 'bun:test'
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { execa } from 'execa'
import { Git } from '../src/tools/Git/Git.js'
import { runGitInspection } from '../src/utils/gitInspection.js'
import { scrubbedEnv } from '../src/utils/platform.js'

const git = (cwd: string, args: string[], reject = true) => execa('git', args, { cwd, env: scrubbedEnv(), extendEnv: false, reject })
const context = (root: string) => ({ sessionId: 'git-environment-policy', workspacePath: root, projectRoot: root, permissionProfile: 'coordinator-integrator' as const, dangerousOperationApproved: true })

it.skipIf(process.platform === 'win32')('does not run configured credential or custom transport helpers and keeps SSH-agent access on standard SSH', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deepseek-git-policy-'))
  const previousEnv = {
    path: process.env.PATH,
    sshAgent: process.env.SSH_AUTH_SOCK,
    sshCommand: process.env.GIT_SSH_COMMAND,
    apiKey: process.env.DEEPSEEK_API_KEY,
  }
  const restoreEnv = () => {
    if (previousEnv.path === undefined) delete process.env.PATH
    else process.env.PATH = previousEnv.path
    if (previousEnv.sshAgent === undefined) delete process.env.SSH_AUTH_SOCK
    else process.env.SSH_AUTH_SOCK = previousEnv.sshAgent
    if (previousEnv.sshCommand === undefined) delete process.env.GIT_SSH_COMMAND
    else process.env.GIT_SSH_COMMAND = previousEnv.sshCommand
    if (previousEnv.apiKey === undefined) delete process.env.DEEPSEEK_API_KEY
    else process.env.DEEPSEEK_API_KEY = previousEnv.apiKey
  }

  try {
    const credentialRepo = join(root, 'credential-repo')
    await mkdir(credentialRepo)
    await git(credentialRepo, ['init', '-b', 'main'])
    const credentialMarker = join(root, 'credential-helper-ran')
    const credentialHelper = join(root, 'credential-helper')
    await writeFile(credentialHelper, `#!/bin/sh\necho invoked > ${JSON.stringify(credentialMarker)}\ncat >/dev/null\n`, { mode: 0o700 })
    await git(credentialRepo, ['config', 'credential.helper', `!${credentialHelper}`])
    const credentialInput = 'protocol=https\nhost=credential-canary.invalid\n\n'

    const unprotectedCredentialRun = await execa('git', ['credential', 'fill'], {
      cwd: credentialRepo, env: { ...scrubbedEnv(), GIT_TERMINAL_PROMPT: '0' }, extendEnv: false, reject: false, input: credentialInput,
    })
    expect(unprotectedCredentialRun.exitCode).not.toBe(0)
    expect((await lstat(credentialMarker)).isFile()).toBe(true)
    await rm(credentialMarker)

    const protectedCredentialRun = await runGitInspection(['credential', 'fill'], credentialRepo, {
      reject: false, input: credentialInput, timeout: 1_000,
    })
    expect(protectedCredentialRun.exitCode).not.toBe(0)
    await expect(lstat(credentialMarker)).rejects.toMatchObject({ code: 'ENOENT' })

    const transportRepo = join(root, 'transport-repo')
    await mkdir(transportRepo)
    await git(transportRepo, ['init', '-b', 'main'])
    await git(transportRepo, ['config', 'user.name', 'Git Policy Test'])
    await git(transportRepo, ['config', 'user.email', 'git-policy@example.invalid'])
    await writeFile(join(transportRepo, 'source.txt'), 'fixture\n')
    await git(transportRepo, ['add', 'source.txt'])
    await git(transportRepo, ['commit', '-m', 'fixture'])
    await git(transportRepo, ['remote', 'add', 'origin', 'fixture::target'])
    await git(transportRepo, ['config', 'protocol.fixture.allow', 'always'])
    const helperBin = join(root, 'helper-bin')
    await mkdir(helperBin)
    const transportMarker = join(root, 'transport-helper-ran')
    await writeFile(join(helperBin, 'git-remote-fixture'), `#!/bin/sh\necho invoked > ${JSON.stringify(transportMarker)}\nprintf 'capabilities\\n\\n'\n`, { mode: 0o700 })
    process.env.PATH = `${helperBin}${delimiter}${previousEnv.path ?? ''}`

    const unprotectedTransportRun = await execa('git', ['push', 'origin', 'HEAD'], {
      cwd: transportRepo, env: { ...scrubbedEnv(), PATH: process.env.PATH }, extendEnv: false, reject: false,
    })
    expect((await lstat(transportMarker)).isFile()).toBe(true)
    expect(unprotectedTransportRun.exitCode).not.toBe(0)
    await rm(transportMarker)

    const protectedTransportRun = await Git.execute({ action: 'push' }, context(transportRepo))
    expect(JSON.parse(protectedTransportRun)).toMatchObject({
      status: 'error', error: { kind: 'conflict', code: 'GIT_REMOTE_EFFECT_UNKNOWN', retryable: false },
    })
    await expect(lstat(transportMarker)).rejects.toMatchObject({ code: 'ENOENT' })

    const customReceivepack = join(helperBin, 'git-remote-fixture')
    await git(transportRepo, ['config', 'remote.origin.receivepack', customReceivepack])
    await expect(runGitInspection(['push', 'origin', 'HEAD'], transportRepo)).rejects.toThrow('remote.origin.receivepack')
    await expect(lstat(transportMarker)).rejects.toMatchObject({ code: 'ENOENT' })
    await git(transportRepo, ['config', '--unset', 'remote.origin.receivepack'])
    await git(transportRepo, ['remote', 'set-url', 'origin', 'git://git-canary.invalid/repo'])
    const proxyMarker = join(root, 'git-proxy-command-ran')
    const gitProxy = join(root, 'git-proxy-command')
    await writeFile(gitProxy, `#!/bin/sh\necho invoked > ${JSON.stringify(proxyMarker)}\nexit 1\n`, { mode: 0o700 })
    await git(transportRepo, ['config', 'core.gitProxy', gitProxy])
    await expect(runGitInspection(['push', 'origin', 'HEAD'], transportRepo)).rejects.toThrow('core.gitproxy')
    await expect(lstat(proxyMarker)).rejects.toMatchObject({ code: 'ENOENT' })

    const sshRepo = join(root, 'ssh-repo')
    await mkdir(sshRepo)
    await git(sshRepo, ['init', '-b', 'main'])
    await git(sshRepo, ['config', 'user.name', 'Git Policy Test'])
    await git(sshRepo, ['config', 'user.email', 'git-policy@example.invalid'])
    await writeFile(join(sshRepo, 'source.txt'), 'fixture\n')
    await git(sshRepo, ['add', 'source.txt'])
    await git(sshRepo, ['commit', '-m', 'fixture'])
    const maliciousSshMarker = join(root, 'configured-ssh-command-ran')
    const maliciousSsh = join(root, 'configured-ssh-command')
    await writeFile(maliciousSsh, `#!/bin/sh\necho invoked > ${JSON.stringify(maliciousSshMarker)}\nexit 1\n`, { mode: 0o700 })
    await git(sshRepo, ['config', 'core.sshCommand', maliciousSsh])
    await git(sshRepo, ['remote', 'add', 'origin', 'ssh://git-canary.invalid/repo'])
    const sshMarker = join(root, 'standard-ssh-ran')
    await writeFile(join(helperBin, 'ssh'), `#!/bin/sh\nprintf '%s:%s' "${'${SSH_AUTH_SOCK:+present}'}" "${'${DEEPSEEK_API_KEY:+present}'}" > ${JSON.stringify(sshMarker)}\nexit 1\n`, { mode: 0o700 })
    process.env.SSH_AUTH_SOCK = join(root, 'fixture-agent.sock')
    process.env.GIT_SSH_COMMAND = maliciousSsh
    process.env.DEEPSEEK_API_KEY = 'synthetic-git-provider-canary'

    const sshResult = await Git.execute({ action: 'push' }, context(sshRepo))
    expect(JSON.parse(sshResult).error).toMatchObject({ kind: 'conflict', code: 'GIT_REMOTE_EFFECT_UNKNOWN' })
    expect(await readFile(sshMarker, 'utf8')).toBe('present:')
    await expect(lstat(maliciousSshMarker)).rejects.toMatchObject({ code: 'ENOENT' })
  } finally {
    restoreEnv()
    await rm(root, { recursive: true, force: true })
  }
}, 15_000)
