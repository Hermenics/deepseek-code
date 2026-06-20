export type ThemeName =
  | 'dark'
  | 'light'
  | 'dark-daltonized'
  | 'light-daltonized'
  | 'dark-ansi'
  | 'light-ansi'

// [OAUTH-DISABLED] OAuth authentication temporarily disabled
export type ProviderName = 'deepseek' | 'bedrock' | 'vertex' | 'local'

export interface ProviderConfig {
  provider: ProviderName
  apiKey?: string
  baseURL?: string
  awsRegion?: string
  awsProfile?: string
  gcpProject?: string
  gcpLocation?: string
  gcpCredentials?: string
  localBaseUrl?: string
  localModel?: string
  proxyApiKey?: string
}
