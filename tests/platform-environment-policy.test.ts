import { afterEach, describe, expect, it } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { isWindows, scrubbedEnv } from '../src/utils/platform.js'

const credentialCanaries = {
  OPENAI_API_KEY: 'openai-key-canary',
  ANTHROPIC_API_KEY: 'anthropic-key-canary',
  AWS_SECRET_ACCESS_KEY: 'aws-secret-canary',
  AWS_SESSION_TOKEN: 'aws-session-canary',
  GITHUB_TOKEN: 'github-token-canary',
}
const previousValues = new Map<string, string | undefined>()

afterEach(() => {
  for (const [key, value] of previousValues) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  previousValues.clear()
})

describe('scrubbed child environment', () => {
  it('omits credential variables while retaining PATH and POSIX locale settings', () => {
    for (const [key, value] of Object.entries(credentialCanaries)) {
      previousValues.set(key, process.env[key])
      process.env[key] = value
    }

    const localeCanaries = isWindows ? {} : { LANG: 'en_US.UTF-8', LC_ALL: 'C.UTF-8' }
    for (const [key, value] of Object.entries(localeCanaries)) {
      previousValues.set(key, process.env[key])
      process.env[key] = value
    }

    const env = scrubbedEnv()
    const script = `process.stdout.write(JSON.stringify(Object.fromEntries(${JSON.stringify([...Object.keys(credentialCanaries), 'PATH', ...Object.keys(localeCanaries)])}.map(key => [key, process.env[key] ?? null]))))`
    const child = spawnSync(process.execPath, ['-e', script], { env, encoding: 'utf8' })

    expect(child.status, child.stderr).toBe(0)
    const inherited = JSON.parse(child.stdout) as Record<string, string | null>
    for (const key of Object.keys(credentialCanaries)) expect(inherited[key]).toBeNull()
    expect(inherited.PATH).toBe(process.env.PATH ?? null)
    for (const [key, value] of Object.entries(localeCanaries)) expect(inherited[key]).toBe(value)
  })
})
