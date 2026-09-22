import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, readFile, rm, stat } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { createProviderProfile, loadProviderProfiles, migrateLegacyProviderProfile, saveProviderProfiles } from '../src/utils/providerProfiles.js'
import { Agent } from '../src/agent/agent.js'

const temporary: string[] = []
async function tempDir(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'deepseek-provider-profiles-'))
  temporary.push(path)
  return path
}
afterEach(async () => { await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true }))) })

describe('provider profiles', () => {
  it('stores multiple credentials privately and loads them back', async () => {
    const path = join(await tempDir(), 'provider-profiles.json')
    const first = { ...createProviderProfile('Work DeepSeek', 'deepseek'), apiKey: 'secret', model: 'deepseek-chat' }
    const second = { ...createProviderProfile('Local', 'local'), localBaseUrl: 'http://localhost:11434/v1' }

    await saveProviderProfiles([first, second], path)

    expect(await loadProviderProfiles(path)).toEqual([first, second])
    // Windows has no POSIX permission bits; the private mode is only observable elsewhere.
    if (process.platform !== 'win32') expect((await stat(path)).mode & 0o777).toBe(0o600)
    expect(await readFile(path, 'utf8')).toContain('"profiles"')
  })

  it('rejects duplicate ids and unsupported providers before writing', async () => {
    const path = join(await tempDir(), 'provider-profiles.json')
    const profile = createProviderProfile('One', 'deepseek')
    await expect(saveProviderProfiles([profile, { ...profile, name: 'Two' }], path)).rejects.toThrow('Duplicate')
    await expect(saveProviderProfiles([{ ...profile, provider: 'oauth' as never }], path)).rejects.toThrow('unsupported provider')
  })

  it('migrates the selected legacy provider and model into a named profile', () => {
    const profile = migrateLegacyProviderProfile(
      { provider: { name: 'deepseek', endpoint: 'https://api.example/v1' }, model: { default: 'deepseek-chat' } },
      { DEEPSEEK_API_KEY: 'old-key' },
      {},
    )
    expect(profile).toMatchObject({
      id: 'legacy-default', name: 'deepseek (current)', provider: 'deepseek',
      apiKey: 'old-key', baseURL: 'https://api.example/v1', model: 'deepseek-chat',
    })
    expect(migrateLegacyProviderProfile({ provider: { name: 'bedrock' } }, { AWS_REGION: 'eu-west-1' }))
      .toMatchObject({ provider: 'bedrock', awsRegion: 'eu-west-1' })
    expect(migrateLegacyProviderProfile({ provider: { name: 'vertex' } }, { GCP_PROJECT: 'project', GCP_CREDENTIALS: '/tmp/service.json' }))
      .toMatchObject({ provider: 'vertex', gcpProject: 'project', gcpCredentials: '/tmp/service.json' })
    expect(migrateLegacyProviderProfile({ provider: { name: 'local', endpoint: 'http://localhost:11434/v1' } }, {}))
      .toMatchObject({ provider: 'local', localBaseUrl: 'http://localhost:11434/v1' })
  })

  it('switches the Agent client, model and orchestration runtime together', async () => {
    const agent = new Agent({ provider: 'deepseek', apiKey: 'test-key' })
    const profile = { ...createProviderProfile('Local dev', 'local'), localBaseUrl: 'http://localhost:11434/v1', model: 'qwen-coder' }
    await agent.readyPromise
    agent.setProviderConfig(profile)

    expect(agent.provider).toBe('local')
    expect(agent.model).toBe('qwen-coder')
    expect(agent.orchestrator.runtimeSnapshot()).toMatchObject({ providerConfig: { provider: 'local' }, model: 'qwen-coder' })
    agent.settings = { model: { default: 'legacy-global-model' } }
    agent.setProviderConfig({ provider: 'local', profileId: 'empty-local-profile', localBaseUrl: 'http://localhost:11434/v1' })
    expect(agent.model).toBe('llama3')
    await agent.shutdown()
  })
})
