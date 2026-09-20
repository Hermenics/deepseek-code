import { randomUUID } from 'crypto'
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'fs/promises'
import { homedir } from 'os'
import { dirname, join } from 'path'
import type { ProviderConfig, ProviderName } from '../types/provider.js'
import type { DeepSeekSettings } from '../settings/types.js'

export interface ProviderProfile extends ProviderConfig {
  id: string
  name: string
}

export function getProviderProfilesPath(): string {
  return join(homedir(), '.deepseek', 'provider-profiles.json')
}

function validateProfiles(value: unknown): ProviderProfile[] {
  if (!Array.isArray(value)) throw new Error('Provider profiles must be an array')
  const ids = new Set<string>()
  const profiles = value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`Profile ${index + 1} must be an object`)
    const profile = item as Record<string, unknown>
    if (typeof profile.id !== 'string' || !profile.id.trim()) throw new Error(`Profile ${index + 1} needs an id`)
    if (ids.has(profile.id)) throw new Error(`Duplicate provider profile id: ${profile.id}`)
    ids.add(profile.id)
    if (typeof profile.name !== 'string' || !profile.name.trim()) throw new Error(`Profile ${index + 1} needs a name`)
    if (!['deepseek', 'bedrock', 'vertex', 'local'].includes(String(profile.provider))) throw new Error(`Profile ${profile.name} has an unsupported provider`)
    for (const field of ['model', 'apiKey', 'baseURL', 'awsRegion', 'awsProfile', 'gcpProject', 'gcpLocation', 'gcpCredentials', 'localBaseUrl', 'localModel']) {
      if (profile[field] !== undefined && typeof profile[field] !== 'string') throw new Error(`${profile.name}.${field} must be text`)
    }
    return profile as unknown as ProviderProfile
  })
  return profiles
}

export async function loadProviderProfiles(path = getProviderProfilesPath()): Promise<ProviderProfile[]> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as { version?: unknown; profiles?: unknown }
    if (parsed.version !== 1) throw new Error('Unsupported provider profile file version')
    return validateProfiles(parsed.profiles)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

export async function saveProviderProfiles(profiles: ProviderProfile[], path = getProviderProfilesPath()): Promise<void> {
  const checked = validateProfiles(profiles)
  const dir = dirname(path)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  await chmod(dir, 0o700)
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, `${JSON.stringify({ version: 1, profiles: checked }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    await rename(temporary, path)
    await chmod(path, 0o600)
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
}

export function createProviderProfile(name: string, provider: ProviderName): ProviderProfile {
  return { id: randomUUID(), name: name.trim(), provider }
}

export function migrateLegacyProviderProfile(
  settings: DeepSeekSettings,
  credentials: Record<string, string>,
  environment: NodeJS.ProcessEnv = process.env,
): ProviderProfile | null {
  const candidate = settings.provider?.name ?? credentials.PROVIDER ?? 'deepseek'
  const provider: ProviderName = ['deepseek', 'bedrock', 'vertex', 'local'].includes(candidate) ? candidate as ProviderName : 'deepseek'
  const profile: ProviderProfile = {
    id: 'legacy-default', name: `${provider} (current)`, provider,
    apiKey: provider === 'deepseek' ? credentials.DEEPSEEK_API_KEY ?? environment.DEEPSEEK_API_KEY : undefined,
    baseURL: provider === 'deepseek' ? settings.provider?.endpoint ?? credentials.DEEPSEEK_BASE_URL ?? environment.DEEPSEEK_BASE_URL : undefined,
    awsRegion: provider === 'bedrock' ? settings.provider?.region ?? credentials.AWS_REGION : undefined,
    awsProfile: provider === 'bedrock' ? settings.provider?.profile ?? credentials.AWS_PROFILE : undefined,
    gcpProject: provider === 'vertex' ? settings.provider?.projectId ?? credentials.GCP_PROJECT : undefined,
    gcpLocation: provider === 'vertex' ? settings.provider?.location ?? credentials.GCP_LOCATION : undefined,
    gcpCredentials: provider === 'vertex' ? credentials.GCP_CREDENTIALS : undefined,
    localBaseUrl: provider === 'local' ? settings.provider?.endpoint ?? credentials.LOCAL_BASE_URL : undefined,
    localModel: provider === 'local' ? credentials.LOCAL_MODEL : undefined,
    model: provider === 'local' ? undefined : typeof settings.model === 'string' ? settings.model : settings.model?.default,
  }
  const ready = (provider === 'deepseek' && !!profile.apiKey) || (provider === 'bedrock' && !!profile.awsRegion) ||
    (provider === 'vertex' && !!profile.gcpProject && !!profile.gcpCredentials) || (provider === 'local' && !!profile.localBaseUrl)
  return ready ? profile : null
}
