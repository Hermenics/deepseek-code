import type { ProviderConfig } from '../types/provider.js'

const INHERITED_ENV = [
  'PATH', 'HOME', 'USERPROFILE', 'TMPDIR', 'TMP', 'TEMP',
  'LANG', 'LC_ALL', 'LC_MESSAGES', 'LC_CTYPE', 'SHELL', 'USER', 'LOGNAME',
  'TERM', 'COLORTERM', 'NODE_ENV',
  'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME', 'XDG_RUNTIME_DIR',
  'DISPLAY', 'WAYLAND_DISPLAY', 'XAUTHORITY', 'DBUS_SESSION_BUS_ADDRESS',
  'DESKTOP_SESSION', 'XDG_CURRENT_DESKTOP', 'XDG_SESSION_TYPE', 'XDG_SESSION_DESKTOP',
  'SYSTEMROOT', 'COMSPEC', 'PATHEXT',
  'DEEPSEEK_CHROME_PATH', 'DEEPSEEK_FEATURES', 'DEEPSEEK_NO_STREAM',
  'DEEPSEEK_STREAM_IDLE_TIMEOUT_MS', 'DEEPSEEK_DISABLE_MEMORY', 'DEEPSEEK_DISABLE_WORKFLOWS',
] as const

const BEDROCK_ENV = [
  'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'AWS_SECURITY_TOKEN',
  'AWS_ROLE_ARN', 'AWS_ROLE_SESSION_NAME', 'AWS_WEB_IDENTITY_TOKEN_FILE',
  'AWS_CONTAINER_CREDENTIALS_RELATIVE_URI', 'AWS_CONTAINER_CREDENTIALS_FULL_URI',
  'AWS_CONTAINER_AUTHORIZATION_TOKEN', 'AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE',
  'AWS_SHARED_CREDENTIALS_FILE', 'AWS_CONFIG_FILE', 'AWS_EC2_METADATA_DISABLED',
] as const

/**
 * Give a bot worker only the host settings it needs. Provider profiles are
 * persisted by loadSavedConfig before spawning; ambient cloud credentials are
 * retained only when Bedrock is the selected provider.
 */
export function botWorkerEnvironment(
  source: NodeJS.ProcessEnv = process.env,
  options: { provider?: ProviderConfig['provider']; remoteBrowser: boolean },
): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {}
  for (const key of INHERITED_ENV) if (source[key] !== undefined) result[key] = source[key]
  if (options.provider === 'bedrock') {
    for (const key of BEDROCK_ENV) if (source[key] !== undefined) result[key] = source[key]
  }
  result.DEEPSEEK_BOT_REMOTE_BROWSER = options.remoteBrowser ? '1' : '0'
  return result
}
