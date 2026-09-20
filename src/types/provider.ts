export type ThemeName =
  | 'dark'
  | 'light'
  | 'dark-daltonized'
  | 'light-daltonized'
  | 'dark-ansi'
  | 'light-ansi'

export type ProviderName = 'deepseek' | 'bedrock' | 'vertex' | 'local'

export interface ProviderConfig {
  provider: ProviderName
  /** Runtime-only link to the selected saved profile. */
  profileId?: string
  /** Preferred primary model when this provider is selected. */
  model?: string
  apiKey?: string
  baseURL?: string
  awsRegion?: string
  awsProfile?: string
  gcpProject?: string
  gcpLocation?: string
  gcpCredentials?: string
  localBaseUrl?: string
  localModel?: string
}
