import { useState, useEffect } from 'react'
import { useKeyboard } from '@opentui/react'
import type { KeyEvent } from '@opentui/core'
import { homedir } from 'os'
import { join } from 'path'
import { mkdir } from 'fs/promises'
import { readJson, writeRaw } from '../../utils/fs.js'
import { saveFullConfig, loadFullConfig, migrateConfigIfNeeded } from '../../utils/credentials.js'
import { WelcomeScreen } from '../layout/WelcomeScreen.js'

const CONFIG_PATH = join(homedir(), '.deepseek', 'config.json')

export type ThemeName = 'dark' | 'light' | 'dark-daltonized' | 'light-daltonized' | 'dark-ansi' | 'light-ansi'

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
}

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

export async function loadSavedConfig(): Promise<{ providerConfig: ProviderConfig | null; theme: ThemeName; language: string | null }> {
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
    }
  } catch {
    return { providerConfig: null, theme: 'dark', language: null }
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
  const currentField = fields[fieldIdx]!

  useEffect(() => {
    if (donePayload) {
      const t = setTimeout(() => onDone(donePayload.theme, donePayload.config), 50)
      return () => clearTimeout(t)
    }
  }, [donePayload, onDone])

  useKeyboard((key: KeyEvent) => {
    if (key.ctrl && key.name === 'c') process.exit(0)

    if (step === 'theme') {
      if (key.name === 'up') { setThemeIdx((i) => (i - 1 + THEMES.length) % THEMES.length); return }
      if (key.name === 'down') { setThemeIdx((i) => (i + 1) % THEMES.length); return }
      if (key.name === 'return') { setStep('provider'); return }
      if (key.name === 'escape') process.exit(0)
      return
    }

    if (step === 'provider') {
      if (key.name === 'up') { setProviderIdx((i) => (i - 1 + PROVIDERS.length) % PROVIDERS.length); return }
      if (key.name === 'down') { setProviderIdx((i) => (i + 1) % PROVIDERS.length); return }
      if (key.name === 'return') { setFieldIdx(0); setCurrentInput(''); setStep('fields'); return }
      if (key.name === 'escape') { setStep('theme'); return }
      return
    }

    if (step === 'fields') {
      if (key.name === 'return') {
        const trimmed = currentInput.trim()
        if (!trimmed && !currentField.optional) { setError(`${currentField.label} cannot be empty.`); return }
        const updated = { ...fieldValues, [currentField.key]: trimmed }
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
      if (key.name === 'backspace') { setCurrentInput((s) => s.slice(0, -1)); setError(''); return }
      if (key.name === 'escape') {
        if (fieldIdx > 0) { setFieldIdx((i) => i - 1); setCurrentInput(fieldValues[fields[fieldIdx - 1]!.key] ?? ''); setError('') }
        else { setStep('provider'); setCurrentInput(''); setError('') }
        return
      }
      if (!key.ctrl && !key.meta && key.raw && key.raw.length === 1) { setCurrentInput((s) => s + key.raw); setError('') }
    }
  })

  if (step === 'done') {
    return <box marginTop={1}><text fg="green">{'✓ Saved! Starting DeepSeek Code…'}</text></box>
  }

  let content: React.ReactNode = null

  if (step === 'theme') {
    content = (
      <box flexDirection="column" marginTop={1}>
        <text>Choose the text style that looks best with your terminal:</text>
        <box flexDirection="column" marginTop={1}>
          {THEMES.map((t, i) => (
            <box key={t.value}>
              <text fg={i === themeIdx ? 'cyan' : undefined}>{i === themeIdx ? '❯ ' : '  '}{t.label}</text>
            </box>
          ))}
        </box>
        <text fg="#888888">{'↑↓ navigate · Enter select · Esc exit'}</text>
      </box>
    )
  } else if (step === 'provider') {
    content = (
      <box flexDirection="column" marginTop={1}>
        <text>Choose your AI provider:</text>
        <box flexDirection="column" marginTop={1}>
          {PROVIDERS.map((p, i) => (
            <box key={p.value} flexDirection="row" gap={2}>
              <text fg={i === providerIdx ? 'cyan' : undefined}>{i === providerIdx ? '❯ ' : '  '}{p.label}</text>
              <text fg="#888888">{p.hint}</text>
            </box>
          ))}
        </box>
        <text fg="#888888">{'↑↓ navigate · Enter select · Esc back'}</text>
      </box>
    )
  } else if (step === 'fields') {
    const progress = `(${fieldIdx + 1}/${fields.length})`
    content = (
      <box flexDirection="column" marginTop={1}>
        <text>{PROVIDERS[providerIdx]!.label + ' setup ' + progress}</text>
        <text>{currentField.label}</text>
        {currentField.hint ? <text fg="#888888">{currentField.hint}</text> : null}
        <box marginTop={1}>
          <text fg="cyan">{'> '}</text>
          <text>{currentField.secret ? '•'.repeat(currentInput.length) || '…' : currentInput || '…'}</text>
          <text fg="cyan">{'█'}</text>
        </box>
        {error ? <text fg="red">{error}</text> : <text fg="#888888">{'Enter to confirm · Esc back'}</text>}
      </box>
    )
  }

  return (
    <box flexDirection="column" paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1}>
      <WelcomeScreen>{content}</WelcomeScreen>
    </box>
  )
}
