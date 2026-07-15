import { useState, useEffect } from 'react'
import useInput from '../../ink/hooks/use-input.js'
import type { Key } from '../../ink/events/input-event.js'
import { execSync } from 'child_process'
import { homedir } from 'os'
import { join } from 'path'
import { mkdir } from 'fs/promises'
import { saveFullConfig, loadFullConfig } from '../../utils/credentials.js'
import { WelcomeScreen } from '../layout/WelcomeScreen.js'
import { getThemeColors } from '../theme.js'
import Box from '../../ink/components/Box.js'
import Text from '../../ink/components/Text.js'

export type { ThemeName, ProviderName, ProviderConfig } from '../../types/provider.js'
import type { ThemeName, ProviderName, ProviderConfig } from '../../types/provider.js'

export const PROVIDERS: { label: string; value: ProviderName; hint: string }[] = [
  { value: 'deepseek', label: 'DeepSeek API',          hint: 'platform.deepseek.com/api_keys' },
  { value: 'bedrock',  label: 'Amazon Bedrock',         hint: 'AWS profile from ~/.aws/credentials' },
  { value: 'vertex',   label: 'Google Vertex AI',       hint: 'GCP project + service account JSON' },
  { value: 'local',    label: 'Local model (Ollama / LM Studio)', hint: 'Any OpenAI-compatible endpoint' },
]

const THEMES: { label: string; value: ThemeName }[] = [
  { label: 'Dark mode', value: 'dark' },
  { label: 'Light mode', value: 'light' },
  { label: 'Dark mode (colorblind-friendly)', value: 'dark-daltonized' },
  { label: 'Light mode (colorblind-friendly)', value: 'light-daltonized' },
  { label: 'Dark mode (ANSI colors only)', value: 'dark-ansi' },
  { label: 'Light mode (ANSI colors only)', value: 'light-ansi' },
]

export async function saveConfig(data: Record<string, string>): Promise<void> {
  const dir = join(homedir(), '.deepseek')
  await mkdir(dir, { recursive: true })
  const existing = await loadFullConfig().catch(() => ({}))
  await saveFullConfig({ ...existing, ...data })
}

export async function loadSavedConfig(): Promise<{ providerConfig: ProviderConfig | null; theme: ThemeName; language: string | null; enchant: boolean }> {
  try {
    const cfg = await loadFullConfig()
    const provider = (cfg.PROVIDER ?? 'deepseek') as ProviderName
    const providerConfig: ProviderConfig = { provider }
    if (provider === 'deepseek' && cfg.DEEPSEEK_API_KEY) {
      providerConfig.apiKey = cfg.DEEPSEEK_API_KEY
      if (cfg.DEEPSEEK_BASE_URL) providerConfig.baseURL = cfg.DEEPSEEK_BASE_URL
    }
    if (provider === 'bedrock') {
      providerConfig.awsRegion = cfg.AWS_REGION
      providerConfig.awsProfile = cfg.AWS_PROFILE
    }
    if (provider === 'vertex') {
      providerConfig.gcpProject = cfg.GCP_PROJECT
      providerConfig.gcpLocation = cfg.GCP_LOCATION
      providerConfig.gcpCredentials = cfg.GCP_CREDENTIALS
    }
    if (provider === 'local') {
      providerConfig.localBaseUrl = cfg.LOCAL_BASE_URL
      providerConfig.localModel = cfg.LOCAL_MODEL
    }
    const isReady =
      (provider === 'deepseek' && !!providerConfig.apiKey) ||
      (provider === 'bedrock' && !!providerConfig.awsRegion) ||
      (provider === 'vertex' && !!providerConfig.gcpProject && !!providerConfig.gcpCredentials) ||
      (provider === 'local' && !!providerConfig.localBaseUrl)
    return {
      providerConfig: isReady ? providerConfig : null,
      theme: (cfg.THEME ?? 'dark') as ThemeName,
      language: cfg.LANGUAGE ?? null,
      enchant: cfg.ENCHANT !== 'false',
    }
  } catch {
    return { providerConfig: null, theme: 'dark', language: null, enchant: true }
  }
}

const PROVIDER_FIELDS: Record<ProviderName, { key: string; label: string; hint: string; secret?: boolean; optional?: boolean }[]> = {
  deepseek: [
    { key: 'DEEPSEEK_API_KEY',  label: 'DeepSeek API Key',  hint: 'platform.deepseek.com/api_keys', secret: true },
    { key: 'DEEPSEEK_BASE_URL', label: 'Base URL (optional)', hint: 'Leave empty to use api.deepseek.com', optional: true },
  ],
  bedrock: [
    { key: 'AWS_REGION',  label: 'AWS Region',       hint: 'e.g. us-east-1' },
    { key: 'AWS_PROFILE', label: 'AWS Profile Name',  hint: 'from ~/.aws/credentials (default: default)' },
  ],
  vertex: [
    { key: 'GCP_PROJECT',     label: 'GCP Project ID', hint: 'your-project-id' },
    { key: 'GCP_LOCATION',    label: 'GCP Location',   hint: 'e.g. us-central1' },
    { key: 'GCP_CREDENTIALS', label: 'Service Account JSON path', hint: '/path/to/sa.json' },
  ],
  local: [
    { key: 'LOCAL_BASE_URL', label: 'Base URL', hint: 'e.g. http://localhost:11434/v1' },
    { key: 'LOCAL_MODEL',    label: 'Model name', hint: 'e.g. deepseek-r1:8b, llama3, mistral' },
  ],
}

type Step = 'theme' | 'provider' | 'fields' | 'done'

interface Props {
  onDone(theme: ThemeName, providerConfig: ProviderConfig): void
}

export function ApiKeySetup({ onDone }: Props) {
  const [step, setStep] = useState<Step>('theme')
  const [themeIdx, setThemeIdx] = useState(0)
  const [providerIdx, setProviderIdx] = useState(0)
  const [fieldIdx, setFieldIdx] = useState(0)
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({})
  const [currentInput, setCurrentInput] = useState('')
  const [error, setError] = useState('')
  const [donePayload, setDonePayload] = useState<{ theme: ThemeName; config: ProviderConfig } | null>(null)

  const selectedTheme = THEMES[themeIdx]!.value
  const selectedProvider = PROVIDERS[providerIdx]!.value
  const fields = PROVIDER_FIELDS[selectedProvider]
  const currentField = fields[fieldIdx]

  useEffect(() => {
    if (donePayload) {
      const t = setTimeout(() => onDone(donePayload.theme, donePayload.config), 50)
      return () => clearTimeout(t)
    }
  }, [donePayload, onDone])

  useInput((input: string, key: Key) => {
    if (key.ctrl && input === 'c') process.exit(0)

    if (step === 'theme') {
      if (key.upArrow) { setThemeIdx((i) => (i - 1 + THEMES.length) % THEMES.length); return }
      if (key.downArrow) { setThemeIdx((i) => (i + 1) % THEMES.length); return }
      if (key.return) { setStep('provider'); return }
      if (key.escape) process.exit(0)
      return
    }

    if (step === 'provider') {
      if (key.upArrow) { setProviderIdx((i) => (i - 1 + PROVIDERS.length) % PROVIDERS.length); return }
      if (key.downArrow) { setProviderIdx((i) => (i + 1) % PROVIDERS.length); return }
      if (key.return) {
        setFieldIdx(0); setCurrentInput(''); setStep('fields')
        return
      }
      if (key.escape) { setStep('theme'); return }
      return
    }

    if (step === 'fields') {
      if (key.return) {
        const trimmed = currentInput.trim()
        if (!trimmed && !currentField!.optional) { setError(`${currentField!.label} cannot be empty.`); return }
        const updated = { ...fieldValues, [currentField!.key]: trimmed }
        setFieldValues(updated)
        setError('')
        if (fieldIdx < fields.length - 1) {
          setFieldIdx((i) => i + 1)
          setCurrentInput('')
        } else {
          saveConfig({ ...updated, PROVIDER: selectedProvider, THEME: selectedTheme })
            .then(() => {
              for (const [k, v] of Object.entries(updated)) if (v) process.env[k] = v
              const providerConfig: ProviderConfig = {
                provider: selectedProvider,
                apiKey: updated['DEEPSEEK_API_KEY'],
                baseURL: updated['DEEPSEEK_BASE_URL'] || undefined,
                awsRegion: updated['AWS_REGION'],
                awsProfile: updated['AWS_PROFILE'],
                gcpProject: updated['GCP_PROJECT'],
                gcpLocation: updated['GCP_LOCATION'],
                gcpCredentials: updated['GCP_CREDENTIALS'],
                localBaseUrl: updated['LOCAL_BASE_URL'],
                localModel: updated['LOCAL_MODEL'],
              }
              setStep('done')
              setDonePayload({ theme: selectedTheme, config: providerConfig })
            })
            .catch((e: unknown) => setError(`Failed to save: ${(e as Error).message}`))
        }
        return
      }
      if (key.backspace) { setCurrentInput((s) => s.slice(0, -1)); setError(''); return }
      if (key.escape) {
        if (fieldIdx > 0) { setFieldIdx((i) => i - 1); setCurrentInput(fieldValues[fields[fieldIdx - 1]!.key] ?? ''); setError('') }
        else { setStep('provider'); setCurrentInput(''); setError('') }
        return
      }
      // Ctrl+Shift+V: paste from clipboard
      if (key.ctrl && key.shift && input === 'v') {
        try {
          const text = execSync('xclip -selection clipboard -o 2>/dev/null || xsel --clipboard --output 2>/dev/null || wl-paste 2>/dev/null', { encoding: 'utf-8', timeout: 2000 }).trim()
          if (text) { setCurrentInput((s) => s + text); setError('') }
        } catch { /* clipboard not available */ }
        return
      }
      if (!key.ctrl && !key.meta && input && input.length >= 1) { setCurrentInput((s) => s + input); setError('') }
    }
  })

  if (step === 'done') {
    return <Box marginTop={1}><Text color="green">{'✓ Saved! Starting DeepSeek Code…'}</Text></Box>
  }

  let content: React.ReactNode = null

  if (step === 'theme') {
    const colors = getThemeColors(selectedTheme)
    content = (
      <Box flexDirection="column" marginTop={1}>
        <Text>Choose the text style that looks best with your terminal:</Text>
        <Box flexDirection="row" marginTop={1} gap={3}>
          {/* Theme list (left) */}
          <Box flexDirection="column">
            {THEMES.map((t, i) => (
              <Box key={t.value}>
                <Text color={i === themeIdx ? 'cyan' : undefined}>{i === themeIdx ? '❯ ' : '  '}{t.label}</Text>
              </Box>
            ))}
          </Box>

          {/* Separator */}
          <Box flexDirection="column">
            {Array.from({ length: THEMES.length }).map((_, i) => (
              <Text key={i} color="#444444">{'│'}</Text>
            ))}
          </Box>

          {/* Diff preview (right) */}
          <Box flexDirection="column">
            <Text color="#888888" italic>{'Preview — demo.js'}</Text>
            <Text color={colors.textDim}>{' function greet() {'}</Text>
            <Text backgroundColor={colors.diffRemoved} color={colors.diffRemovedWord}>{'-  console.log("Hello, World!");'}</Text>
            <Text backgroundColor={colors.diffAdded} color={colors.diffAddedWord}>{'+  console.log("Hello, DeepSeek!");'}</Text>
            <Text color={colors.textDim}>{' }'}</Text>
          </Box>
        </Box>
        <Text color="#888888">{'↑↓ navigate · Enter select · Esc exit'}</Text>
      </Box>
    )
  } else if (step === 'provider') {
    content = (
      <Box flexDirection="column" marginTop={1}>
        <Text>Choose your AI provider:</Text>
        <Box flexDirection="column" marginTop={1}>
          {PROVIDERS.map((p, i) => (
            <Box key={p.value} flexDirection="row" gap={2}>
              <Text color={i === providerIdx ? 'cyan' : undefined}>{i === providerIdx ? '❯ ' : '  '}{p.label}</Text>
              <Text color="#888888">{p.hint}</Text>
            </Box>
          ))}
        </Box>
        <Text color="#888888">{'↑↓ navigate · Enter select · Esc back'}</Text>
      </Box>
    )
  } else if (step === 'fields') {
    const progress = `(${fieldIdx + 1}/${fields.length})`
    content = (
      <Box flexDirection="column" marginTop={1}>
        <Text>{PROVIDERS[providerIdx]!.label + ' setup ' + progress}</Text>
        <Text>{currentField!.label}</Text>
        {currentField!.hint ? <Text color="#888888">{currentField!.hint}</Text> : null}
        <Box marginTop={1}>
          <Text color="cyan">{'> '}</Text>
          <Text>{currentField!.secret ? '•'.repeat(currentInput.length) || '…' : currentInput || '…'}</Text>
          <Text color="cyan">{'█'}</Text>
        </Box>
        {error ? <Text color="red">{error}</Text> : <Text color="#888888">{'Enter to confirm · Esc back'}</Text>}
      </Box>
    )
  }

  return (
    <Box flexDirection="column" paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1}>
      <WelcomeScreen>{content}</WelcomeScreen>
    </Box>
  )
}
