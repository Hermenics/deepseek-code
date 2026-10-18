import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { delimiter, join, resolve } from 'path'
import { tmpdir } from 'os'
import { pathToFileURL } from 'url'

const CANARY_VARIABLES = [
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'DEEPSEEK_API_KEY',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'AZURE_CLIENT_SECRET',
  'SSH_AUTH_SOCK',
]
const PROXY_VARIABLES = ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy']
const OBSERVED_ENV_VARIABLES = [...CANARY_VARIABLES, ...PROXY_VARIABLES]
const EXPECTED_PROXY_VALUES = [
  'http://proxy.example:8080', 'unset', 'http://all-proxy.example:8080', 'localhost,.example.test',
  'http://lower-proxy.example:3128', 'unset', 'http://lower-all-proxy.example:1080', 'localhost',
]
const fakeGitTest = process.platform === 'win32' ? it.skip : it
const PLUGIN_INSTALLER_URL = pathToFileURL(resolve(import.meta.dir, '../src/plugins/installer.ts')).href
const SKILL_INSTALLER_URL = pathToFileURL(resolve(import.meta.dir, '../src/skills/installer.ts')).href
const PLATFORM_URL = pathToFileURL(resolve(import.meta.dir, '../src/utils/platform.ts')).href

let testDir: string

function installFakeGit(): string {
  const binDir = join(testDir, 'bin')
  mkdirSync(binDir, { recursive: true })
  const gitPath = join(binDir, 'git')
  const observedValues = OBSERVED_ENV_VARIABLES.map((key) => `"\${${key}-unset}"`).join(' ')
  const script = `#!/bin/sh
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
printf '%s' "$1" >> "$script_dir/observed.tsv"
printf '\\t%s' ${observedValues} >> "$script_dir/observed.tsv"
printf '\\n' >> "$script_dir/observed.tsv"
if [ "$1" = "clone" ]; then
  destination="$5"
  mkdir -p "$destination/.git"
  printf '%s' '{"name":"fixture-plugin","version":"2.0.0"}' > "$destination/plugin.json"
  cat > "$destination/SKILL.md" <<'EOF'
---
name: fixture-skill
description: Fixture skill used for environment isolation tests.
---
EOF
  exit 0
fi
if [ "$1" = "rev-parse" ]; then
  printf 'fixture-commit\\n'
  exit 0
fi
exit 1
`
  writeFileSync(gitPath, script, { mode: 0o755 })
  return binDir
}

function childEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    PATH: [join(testDir, 'bin'), process.env.PATH ?? ''].filter(Boolean).join(delimiter),
    TMPDIR: testDir,
  }
  if (process.platform === 'win32') {
    for (const key of ['SystemRoot', 'windir', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP', 'USERPROFILE']) {
      if (process.env[key] !== undefined) env[key] = process.env[key]
    }
  }
  return env
}

async function runInstallerWorker(body: string): Promise<string> {
  const workerPath = join(testDir, 'installer-worker.ts')
  const worker = [
    `import { installPlugin, updatePlugin } from ${JSON.stringify(PLUGIN_INSTALLER_URL)}`,
    `import { installSkill, updateSkill } from ${JSON.stringify(SKILL_INSTALLER_URL)}`,
    `import { gitInstallerEnv } from ${JSON.stringify(PLATFORM_URL)}`,
    body,
  ].join('\n')
  writeFileSync(workerPath, worker)

  const child = Bun.spawn([process.execPath, workerPath], {
    cwd: resolve(import.meta.dir, '..'),
    env: childEnvironment(),
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  expect(exitCode, `Installer worker failed: ${stderr || stdout}`).toBe(0)
  return stdout
}

function testEnvironmentSetup(): string {
  return `
for (const key of ${JSON.stringify(CANARY_VARIABLES)}) process.env[key] = \`canary-\${key.toLowerCase()}\`
Object.assign(process.env, {
  HTTP_PROXY: 'http://proxy.example:8080',
  HTTPS_PROXY: 'https://proxy-user:proxy-secret@proxy.example:8443',
  ALL_PROXY: 'http://all-proxy.example:8080',
  NO_PROXY: 'localhost,.example.test',
  http_proxy: 'http://lower-proxy.example:3128',
  https_proxy: 'https://lower-user:lower-secret@proxy.example:9443',
  all_proxy: 'http://lower-all-proxy.example:1080',
  no_proxy: 'localhost',
})`
}

function expectGitChildrenScrubbed(expectedCommands: string[]): void {
  const output = readFileSync(join(testDir, 'bin', 'observed.tsv'), 'utf8').trim()
  const rows = output.split('\n').map((line) => line.split('\t'))
  expect(rows.map(([command]) => command)).toEqual(expectedCommands)
  for (const row of rows) {
    expect(row.slice(1, CANARY_VARIABLES.length + 1)).toEqual(CANARY_VARIABLES.map(() => 'unset'))
    expect(row.slice(CANARY_VARIABLES.length + 1)).toEqual(EXPECTED_PROXY_VALUES)
  }
}

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'dsk-installer-env-'))
  installFakeGit()
})

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('installer Git child environments', () => {
  fakeGitTest('scrubs credential environment from plugin install and update Git children', async () => {
    const output = await runInstallerWorker(`
${testEnvironmentSetup()}
process.env.DEEPSEEK_PLUGINS_DIR = ${JSON.stringify(join(testDir, 'plugins'))}
const installed = await installPlugin('fixture/plugin')
const updated = await updatePlugin('fixture-plugin')
process.stdout.write(JSON.stringify([installed, updated]))
`)
    expect(JSON.parse(output)).toEqual([
      { ok: true, name: 'fixture-plugin' },
      { ok: true, name: 'fixture-plugin' },
    ])
    expectGitChildrenScrubbed(['clone', 'rev-parse', 'clone', 'rev-parse'])
  })

  fakeGitTest('scrubs credential environment from skill install and update Git children', async () => {
    const skillsDir = join(testDir, 'skills')
    const output = await runInstallerWorker(`
${testEnvironmentSetup()}
const skillsDir = ${JSON.stringify(skillsDir)}
const installed = await installSkill('fixture/skill', skillsDir)
const updated = await updateSkill('fixture-skill', skillsDir)
process.stdout.write(JSON.stringify([installed, updated]))
`)
    expect(JSON.parse(output)).toEqual([
      { ok: true, name: 'fixture-skill' },
      { ok: true, name: 'fixture-skill' },
    ])
    expectGitChildrenScrubbed(['clone', 'rev-parse', 'clone', 'rev-parse'])
  })

  it('rejects authenticated proxies and control or oversized NO_PROXY values', async () => {
    const output = await runInstallerWorker(`
Object.assign(process.env, {
  HTTP_PROXY: 'http://user:secret@proxy.example:8080',
  HTTPS_PROXY: 'https://proxy.example:8443\\nmalicious',
  ALL_PROXY: 'socks5://proxy.example:1080',
  NO_PROXY: 'localhost,\\nexample.test',
  http_proxy: 'http://lower-user:secret@proxy.example:8080',
  https_proxy: 'file:///tmp/proxy',
  all_proxy: 'http://lower-user:secret@proxy.example:8080',
  no_proxy: 'x'.repeat(2049),
})
const env = gitInstallerEnv()
process.stdout.write(JSON.stringify(${JSON.stringify(PROXY_VARIABLES)}.map((key) => env[key] ?? null)))
`)
    expect(JSON.parse(output)).toEqual(PROXY_VARIABLES.map(() => null))
  })

  it('rejects proxy URLs carrying values in query, fragment, or path', async () => {
    const output = await runInstallerWorker(`
Object.assign(process.env, {
  HTTP_PROXY: 'http://proxy.example:8080?token=secret',
  HTTPS_PROXY: 'https://proxy.example:8443#token',
  ALL_PROXY: 'http://proxy.example:8080/private',
})
const env = gitInstallerEnv()
process.stdout.write(JSON.stringify(['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY'].map((key) => env[key] ?? null)))
`)
    expect(JSON.parse(output)).toEqual([null, null, null])
  })
})
