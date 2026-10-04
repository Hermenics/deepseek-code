import { describe, expect, it } from 'bun:test'
import { botWorkerEnvironment } from '../src/bots/environment.js'

describe('bot worker environment', () => {
  it('keeps runtime/display settings but drops unrelated secrets and control-plane credentials', () => {
    const source = {
      PATH: '/usr/bin', HOME: '/home/test', DISPLAY: ':0', DEEPSEEK_FEATURES: 'browser',
      DEEPSEEK_BOTS_TOKEN: 'panel-secret', DEEPSEEK_API_KEY: 'provider-secret',
      OPENAI_API_KEY: 'other-provider-secret', CUSTOM_SECRET: 'unclassified-secret',
      AWS_ACCESS_KEY_ID: 'aws-access', AWS_SECRET_ACCESS_KEY: 'aws-secret',
    }
    const result = botWorkerEnvironment(source, { provider: 'local', remoteBrowser: false })
    expect(result).toMatchObject({ PATH: '/usr/bin', HOME: '/home/test', DISPLAY: ':0', DEEPSEEK_FEATURES: 'browser', DEEPSEEK_BOT_REMOTE_BROWSER: '0' })
    for (const key of ['DEEPSEEK_BOTS_TOKEN', 'DEEPSEEK_API_KEY', 'OPENAI_API_KEY', 'CUSTOM_SECRET', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY']) {
      expect(result[key as keyof typeof result]).toBeUndefined()
    }
  })

  it('retains cloud credentials only for an explicitly selected Bedrock provider', () => {
    const source = { PATH: '/usr/bin', AWS_ACCESS_KEY_ID: 'aws-access', AWS_SECRET_ACCESS_KEY: 'aws-secret', AWS_SESSION_TOKEN: 'aws-session' }
    expect(botWorkerEnvironment(source, { provider: 'bedrock', remoteBrowser: true })).toMatchObject({
      PATH: '/usr/bin', AWS_ACCESS_KEY_ID: 'aws-access', AWS_SECRET_ACCESS_KEY: 'aws-secret', AWS_SESSION_TOKEN: 'aws-session',
      DEEPSEEK_BOT_REMOTE_BROWSER: '1',
    })
    expect(botWorkerEnvironment(source, { provider: 'deepseek', remoteBrowser: false })).toMatchObject({
      PATH: '/usr/bin', DEEPSEEK_BOT_REMOTE_BROWSER: '0',
    })
    expect(botWorkerEnvironment(source, { provider: 'deepseek', remoteBrowser: false }).AWS_ACCESS_KEY_ID).toBeUndefined()
  })
})
