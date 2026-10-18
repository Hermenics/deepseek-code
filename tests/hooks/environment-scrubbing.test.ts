import { afterEach, describe, expect, it } from 'bun:test'
import { buildInput, runHookCommand } from '../../src/hooks/executor.js'
import { isWindows, scrubbedEnv } from '../../src/utils/platform.js'

const credentialCanaries = {
  OPENAI_API_KEY: 'openai-hook-canary',
  DEEPSEEK_API_KEY: 'deepseek-hook-canary',
  ANTHROPIC_API_KEY: 'anthropic-hook-canary',
  AWS_ACCESS_KEY_ID: 'aws-access-hook-canary',
  AWS_SECRET_ACCESS_KEY: 'aws-secret-hook-canary',
  AWS_SESSION_TOKEN: 'aws-session-hook-canary',
  AZURE_CLIENT_SECRET: 'azure-hook-canary',
  AZURE_OPENAI_API_KEY: 'azure-openai-hook-canary',
  GOOGLE_API_KEY: 'google-api-hook-canary',
  GOOGLE_APPLICATION_CREDENTIALS: '/tmp/google-credentials-hook-canary.json',
  CLOUDSDK_AUTH_ACCESS_TOKEN: 'gcloud-token-hook-canary',
  GITHUB_TOKEN: 'github-hook-canary',
  OPENROUTER_API_KEY: 'openrouter-hook-canary',
  GROQ_API_KEY: 'groq-hook-canary',
  MISTRAL_API_KEY: 'mistral-hook-canary',
}
const previousValues = new Map<string, string | undefined>()

afterEach(() => {
  for (const [key, value] of previousValues) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  previousValues.clear()
})

describe('hook child environment', () => {
  it('does not inherit ambient credentials and keeps required runtime variables', async () => {
    for (const [key, value] of Object.entries(credentialCanaries)) {
      previousValues.set(key, process.env[key])
      process.env[key] = value
    }

    const localeCanaries = isWindows ? {} : { LANG: 'en_US.UTF-8', LC_ALL: 'C.UTF-8' }
    for (const [key, value] of Object.entries(localeCanaries)) {
      previousValues.set(key, process.env[key])
      process.env[key] = value
    }

    const pathCanary = 'hook-env-path-canary'
    previousValues.set('PATH', process.env.PATH)
    process.env.PATH = `${process.env.PATH ?? ''}${isWindows ? ';' : ':'}${pathCanary}`

    const command = isWindows ? 'set' : 'env'
    const output = await runHookCommand({ type: 'command', command }, buildInput({ event: 'SessionStart', session_id: 'env-scrubbing-test' }))
    const inherited = Object.fromEntries(output.split(/\r?\n/).flatMap((line) => {
      const separator = line.indexOf('=')
      return separator < 0 ? [] : [[line.slice(0, separator), line.slice(separator + 1)]]
    }))

    for (const key of Object.keys(credentialCanaries)) {
      const inheritedKey = Object.keys(inherited).find(candidate => candidate.toLowerCase() === key.toLowerCase())
      expect(inheritedKey).toBeUndefined()
    }
    const pathKey = Object.keys(inherited).find(candidate => candidate.toLowerCase() === 'path')
    expect(pathKey).toBeDefined()
    expect(inherited[pathKey!]?.split(isWindows ? ';' : ':')).toContain(pathCanary)
    expect(scrubbedEnv().PATH).toContain(pathCanary)
    for (const [key, value] of Object.entries(localeCanaries)) expect(inherited[key]).toBe(value)
  })
})
