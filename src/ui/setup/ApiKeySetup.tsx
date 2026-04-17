import React, { useState, useEffect } from 'react'
import { Box, Text, useInput } from 'ink'
import { homedir } from 'os'
import { join } from 'path'
import { mkdir } from 'fs/promises'
import { readJson, writeRaw } from '../../utils/fs.js'
import { WelcomeScreen } from '../layout/WelcomeScreen.js'

const CONFIG_PATH = join(homedir(), '.deepseek-code', 'config.json')

export type ThemeName = 'dark' | 'light' | 'dark-daltonized' | 'light-daltonized' | 'dark-ansi' | 'light-ansi'

export type ProviderName = 'deepseek' | 'bedrock' | 'vertex' | 'local'

export interface ProviderConfig {
  provider: ProviderName
  // deepseek
  apiKey?: string
  // bedrock
  awsRegion?: string
  awsAccessKeyId?: string
  awsSecretAccessKey?: string
  // vertex
  gcpProject?: string
  gcpLocation?: string
  gcpCredentials?: string // path to service account JSON
  // local (OpenAI-compatible)
  localBaseUrl?: string
  localModel?: string
}

export const PROVIDERS: { label: string; value: ProviderName; hint: string }[] = [
  { value: 'deepseek', label: 'DeepSeek API',          hint: 'platform.deepseek.com/api_keys' },
  { value: 'bedrock',  label: 'Amazon Bedrock',         hint: 'AWS credentials (access key + secret)' },
  { value: 'vertex',   label: 'Google Vertex AI',       hint: 'GCP project + service account JSON' },
  { value: 'local',    label: 'Modelo local (Ollama / LM Studio)', hint: 'Any OpenAI-compatible endpoint' },
]

const THEMES: { label: string; value: ThemeName }[] = [
  { label: 'Dark mode', value: 'dark' },
  { label: 'Light mode', value: 'light' },
  { label: 'Dark mode (colorblind-friendly)', value: 'dark-daltonized' },
  { label: 'Light mode (colorblind-friendly)', value: 'light-daltonized' },
  { label: 'Dark mode (ANSI colors only)', value: 'dark-ansi' },
  { label: 'Light mode (ANSI colors only)', value: 'light-ansi' },
]

// Diff colors per theme
const DIFF_COLORS: Record<ThemeName, { added: string; removed: string; addedWord: string; removedWord: string }> = {
  'dark':             { added: 'rgb(34,92,43)',    removed: 'rgb(122,41,54)',  addedWord: 'rgb(56,166,96)',   removedWord: 'rgb(179,89,107)' },
  'light':            { added: 'rgb(105,219,124)', removed: 'rgb(255,168,180)',addedWord: 'rgb(47,157,68)',   removedWord: 'rgb(209,69,75)'  },
  'dark-daltonized':  { added: 'rgb(0,68,102)',    removed: 'rgb(102,0,0)',    addedWord: 'rgb(0,119,179)',   removedWord: 'rgb(179,0,0)'    },
  'light-daltonized': { added: 'rgb(153,204,255)', removed: 'rgb(255,204,204)',addedWord: 'rgb(51,102,204)',  removedWord: 'rgb(153,51,51)'  },
  'dark-ansi':        { added: 'green',            removed: 'red',             addedWord: 'greenBright',      removedWord: 'redBright'       },
  'light-ansi':       { added: 'green',            removed: 'red',             addedWord: 'greenBright',      removedWord: 'redBright'       },
}

const DIFF_LINES = [
  { type: 'context', text: ' function greet() {' },
  { type: 'removed', text: '-  console.log("Hello, World!");' },
  { type: 'added',   text: '+  console.log("Hello, DeepSeek!");' },
  { type: 'context', text: ' }' },
]

function DiffPreview({ theme }: { theme: ThemeName }) {
  const c = DIFF_COLORS[theme]
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1} marginTop={1}>
      <Text dimColor>demo.js</Text>
      {DIFF_LINES.map((line, i) => (
        <Text key={i} backgroundColor={line.type === 'added' ? c.added : line.type === 'removed' ? c.removed : undefined}>
          {line.type === 'added'
            ? <Text color={c.addedWord}>{line.text}</Text>
            : line.type === 'removed'
            ? <Text color={c.removedWord}>{line.text}</Text>
            : <Text dimColor>{line.text}</Text>}
        </Text>
      ))}
    </Box>
  )
}

export async function saveConfig(data: Record<string, string>): Promise<void> {
  const dir = join(homedir(), '.deepseek-code')
  await mkdir(dir, { recursive: true })
  const existing = await readJson<Record<string, string>>(CONFIG_PATH).catch(() => ({}))
  await writeRaw(CONFIG_PATH, JSON.stringify({ ...existing, ...data }, null, 2))
}

export async function loadSavedConfig(): Promise<{ providerConfig: ProviderConfig | null; theme: ThemeName; language: string | null }> {
  try {
    const cfg = await readJson<Record<string, string>>(CONFIG_PATH)
    const provider = (cfg.PROVIDER ?? 'deepseek') as ProviderName
    const providerConfig: ProviderConfig = { provider }
    if (provider === 'deepseek' && cfg.DEEPSEEK_API_KEY) providerConfig.apiKey = cfg.DEEPSEEK_API_KEY
    if (provider === 'bedrock') {
      providerConfig.awsRegion = cfg.AWS_REGION
      providerConfig.awsAccessKeyId = cfg.AWS_ACCESS_KEY_ID
      providerConfig.awsSecretAccessKey = cfg.AWS_SECRET_ACCESS_KEY
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
      (provider === 'vertex' && !!providerConfig.gcpProject) ||
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

// Fields per provider, in order
const PROVIDER_FIELDS: Record<ProviderName, { key: string; label: string; hint: string; secret?: boolean }[]> = {
  deepseek: [
    { key: 'DEEPSEEK_API_KEY', label: 'DeepSeek API Key', hint: 'platform.deepseek.com/api_keys', secret: true },
  ],
  bedrock: [
    { key: 'AWS_REGION',            label: 'AWS Region',            hint: 'e.g. us-east-1' },
    { key: 'AWS_ACCESS_KEY_ID',     label: 'AWS Access Key ID',     hint: 'IAM user with Bedrock access' },
    { key: 'AWS_SECRET_ACCESS_KEY', label: 'AWS Secret Access Key', hint: '', secret: true },
  ],
  vertex: [
    { key: 'GCP_PROJECT',     label: 'GCP Project ID', hint: 'your-project-id' },
    { key: 'GCP_LOCATION',    label: 'GCP Location',   hint: 'e.g. us-central1' },
    { key: 'GCP_CREDENTIALS', label: 'Service Account JSON path', hint: '/path/to/sa.json' },
  ],
  local: [
    { key: 'LOCAL_BASE_URL', label: 'Base URL', hint: 'e.g. http://localhost:11434/v1  (OpenAI-compatible)' },
    { key: 'LOCAL_MODEL',    label: 'Model name', hint: 'e.g. deepseek-r1:8b, llama3, mistral, qwen2.5-coder' },
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
  // Stored when setup completes — useEffect calls onDone after render
  const [donePayload, setDonePayload] = useState<{ theme: ThemeName; config: ProviderConfig } | null>(null)

  const selectedTheme = THEMES[themeIdx]!.value
  const selectedProvider = PROVIDERS[providerIdx]!.value
  const fields = PROVIDER_FIELDS[selectedProvider]
  const currentField = fields[fieldIdx]!

  // Call onDone after the 'done' step has rendered — avoids stdin event leaking into App
  useEffect(() => {
    if (donePayload) {
      const t = setTimeout(() => onDone(donePayload.theme, donePayload.config), 50)
      return () => clearTimeout(t)
    }
  }, [donePayload])

  useInput((char, key) => {
    // Ctrl+C always exits during setup
    if (key.ctrl && char === 'c') process.exit(0)

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
      if (key.return) { setFieldIdx(0); setCurrentInput(''); setStep('fields'); return }
      if (key.escape) { setStep('theme'); return }
      return
    }

    if (step === 'fields') {
      if (key.return) {
        const trimmed = currentInput.trim()
        if (!trimmed) { setError(`${currentField.label} cannot be empty.`); return }
        const updated = { ...fieldValues, [currentField.key]: trimmed }
        setFieldValues(updated)
        setError('')
        if (fieldIdx < fields.length - 1) {
          setFieldIdx((i) => i + 1)
          setCurrentInput('')
        } else {
          // All fields collected — save and finish
          saveConfig({ ...updated, PROVIDER: selectedProvider, THEME: selectedTheme })
            .then(() => {
              // Set env vars for immediate use
              for (const [k, v] of Object.entries(updated)) process.env[k] = v
              const providerConfig: ProviderConfig = {
                provider: selectedProvider,
                apiKey: updated['DEEPSEEK_API_KEY'],
                awsRegion: updated['AWS_REGION'],
                awsAccessKeyId: updated['AWS_ACCESS_KEY_ID'],
                awsSecretAccessKey: updated['AWS_SECRET_ACCESS_KEY'],
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
      if (key.backspace || key.delete) { setCurrentInput((s) => s.slice(0, -1)); setError(''); return }
      if (key.escape) {
        if (fieldIdx > 0) { setFieldIdx((i) => i - 1); setCurrentInput(fieldValues[fields[fieldIdx - 1]!.key] ?? ''); setError('') }
        else { setStep('provider'); setCurrentInput(''); setError('') }
        return
      }
      if (!key.ctrl && !key.meta && char) { setCurrentInput((s) => s + char); setError('') }
    }
  })

  if (step === 'done') {
    return <Box marginTop={1}><Text color="green">✓ Saved! Starting DeepSeek Code…</Text></Box>
  }

  let content: React.ReactNode = null

  if (step === 'theme') {
    content = (
      <Box flexDirection="column" gap={1} marginTop={1}>
        <Text>Choose the text style that looks best with your terminal:</Text>
        <Box flexDirection="column">
          {THEMES.map((t, i) => (
            <Box key={t.value}>
              <Text color={i === themeIdx ? 'cyan' : undefined}>{i === themeIdx ? '❯ ' : '  '}{t.label}</Text>
            </Box>
          ))}
        </Box>
        <DiffPreview theme={selectedTheme} />
        <Text dimColor>↑↓ navigate · Enter select · Esc exit</Text>
      </Box>
    )
  } else if (step === 'provider') {
    content = (
      <Box flexDirection="column" gap={1} marginTop={1}>
        <Text>Choose your AI provider:</Text>
        <Box flexDirection="column">
          {PROVIDERS.map((p, i) => (
            <Box key={p.value} gap={2}>
              <Text color={i === providerIdx ? 'cyan' : undefined}>{i === providerIdx ? '❯ ' : '  '}{p.label}</Text>
              <Text dimColor>{p.hint}</Text>
            </Box>
          ))}
        </Box>
        <Text dimColor>↑↓ navigate · Enter select · Esc back</Text>
      </Box>
    )
  } else if (step === 'fields') {
    const progress = `(${fieldIdx + 1}/${fields.length})`
    content = (
      <Box flexDirection="column" gap={1} marginTop={1}>
        <Text bold>{PROVIDERS[providerIdx]!.label} setup {progress}</Text>
        <Text bold>{currentField.label}</Text>
        {currentField.hint ? <Text dimColor>{currentField.hint}</Text> : null}
        <Box marginTop={1}>
          <Text color="cyan">{'> '}</Text>
          <Text>{currentField.secret ? '•'.repeat(currentInput.length) || <Text dimColor>…</Text> : currentInput || <Text dimColor>…</Text>}</Text>
          <Text color="cyan">█</Text>
        </Box>
        {error ? <Text color="red">{error}</Text> : <Text dimColor>Enter to confirm · Esc back</Text>}
      </Box>
    )
  }

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <WelcomeScreen>{content}</WelcomeScreen>
    </Box>
  )
}
