import { useState, useEffect } from 'react'
import useInput from '../../ink/hooks/use-input.js'
import type { Key } from '../../ink/events/input-event.js'
import { homedir } from 'os'
import { join } from 'path'
import { mkdir } from 'fs/promises'
import { saveFullConfig, loadFullConfig } from '../../utils/credentials.js'
import { loadMergedSettings, saveUserSettings } from '../../settings/index.js'
import { WelcomeScreen } from '../layout/WelcomeScreen.js'
import { getThemeColors } from '../theme.js'
import Box from '../../ink/components/Box.js'
import Text from '../../ink/components/Text.js'

export type { ThemeName, ProviderName, ProviderConfig } from '../../types/provider.js'
import type { ThemeName, ProviderName, ProviderConfig } from '../../types/provider.js'
import { readClipboardSync } from '../../utils/platform.js'
import { afterKeyCheck, checkOfficialDeepSeekApi } from './deepseekHealth.js'
import { loadProviderProfiles, migrateLegacyProviderProfile, saveProviderProfiles, type ProviderProfile } from '../../utils/providerProfiles.js'

export const PROVIDERS: { label: string; value: ProviderName; hint: string }[] = [
  { value: 'deepseek', label: 'DeepSeek API',          hint: 'platform.deepseek.com/api_keys' },
  { value: 'bedrock',  label: 'Amazon Bedrock',         hint: 'AWS profile from ~/.aws/credentials' },
  { value: 'vertex',   label: 'Google Vertex AI',       hint: 'GCP project + service account JSON' },
  { value: 'local',    label: 'Local model, no API key (Ollama / LM Studio)', hint: 'Sends no credentials. A proxy that authenticates needs DeepSeek API with a Base URL' },
]

const THEMES: { label: string; value: ThemeName }[] = [
  { label: 'Dark mode', value: 'dark' },
  { label: 'Light mode', value: 'light' },
  { label: 'Dark mode (colorblind-friendly)', value: 'dark-daltonized' },
  { label: 'Light mode (colorblind-friendly)', value: 'light-daltonized' },
  { label: 'Dark mode (ANSI colors only)', value: 'dark-ansi' },
  { label: 'Light mode (ANSI colors only)', value: 'light-ansi' },
]

/** Merges the given keys into the saved credentials config (creating `~/.deepseek` if needed) without dropping existing entries. */
export async function saveConfig(data: Record<string, string>): Promise<void> {
  const dir = join(homedir(), '.deepseek')
  await mkdir(dir, { recursive: true })
  const existing = await loadFullConfig().catch(() => ({}))
  await saveFullConfig({ ...existing, ...data })
}

/** Loads the active provider profile (migrating a legacy single-provider config and picking the first profile when none is active) plus theme, language and prompt-refiner settings; providerConfig is null unless its required fields are set, and any failure yields safe defaults. */
export async function loadSavedConfig(): Promise<{ providerConfig: ProviderConfig | null; theme: ThemeName; language: string | null; enchant: boolean }> {
  try {
    const [cfg, settings] = await Promise.all([loadFullConfig(), loadMergedSettings()])
    let profiles = await loadProviderProfiles()
    if (profiles.length === 0) {
      const legacy = migrateLegacyProviderProfile(settings, cfg)
      if (legacy) {
        profiles = [legacy]
        await saveProviderProfiles(profiles)
      }
    }
    let profile = profiles.find(entry => entry.id === settings.provider?.activeProfileId)
    if (!profile && profiles.length) {
      profile = profiles[0]
      if (profile) await saveUserSettings({ provider: { activeProfileId: profile.id } })
    }
    const providerConfig: ProviderConfig | null = profile ? { ...profile, profileId: profile.id } : null
    const provider = providerConfig?.provider ?? 'deepseek'
    const isReady =
      (provider === 'deepseek' && !!providerConfig?.apiKey) ||
      (provider === 'bedrock' && !!providerConfig?.awsRegion) ||
      (provider === 'vertex' && !!providerConfig?.gcpProject && !!providerConfig.gcpCredentials) ||
      (provider === 'local' && !!providerConfig?.localBaseUrl)
    return {
      providerConfig: isReady ? providerConfig : null,
      theme: (settings.interface?.theme ?? cfg.THEME ?? 'dark') as ThemeName,
      language: settings.interface?.language ?? cfg.LANGUAGE ?? null,
      enchant: settings.promptRefiner?.enabled ?? cfg.ENCHANT !== 'false',
    }
  } catch {
    return { providerConfig: null, theme: 'dark', language: null, enchant: false }
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

/** First-run wizard: picks a theme, then a provider, then prompts for that provider's fields, saving credentials and a provider profile before calling onDone. */
export function ApiKeySetup({ onDone }: Props) {
  const [step, setStep] = useState<Step>('theme')
  const [themeIdx, setThemeIdx] = useState(0)
  const [providerIdx, setProviderIdx] = useState(0)
  const [fieldIdx, setFieldIdx] = useState(0)
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({})
  const [currentInput, setCurrentInput] = useState('')
  const [error, setError] = useState('')
  const [checkingHealth, setCheckingHealth] = useState(false)
  const [saving, setSaving] = useState(false)
  const [showCustomBaseUrl, setShowCustomBaseUrl] = useState(false)
  // Set when the key check sends the user to the base URL field; `required` after a rejected key.
  const [baseUrlNotice, setBaseUrlNotice] = useState<{ required: boolean; text: string } | null>(null)
  const [donePayload, setDonePayload] = useState<{ theme: ThemeName; config: ProviderConfig } | null>(null)

  const selectedTheme = THEMES[themeIdx]!.value
  const selectedProvider = PROVIDERS[providerIdx]!.value
  const fields = selectedProvider === 'deepseek' && !showCustomBaseUrl
    ? PROVIDER_FIELDS.deepseek.slice(0, 1)
    : PROVIDER_FIELDS[selectedProvider]
  const currentField = fields[fieldIdx]

  const completeSetup = (updated: Record<string, string>) => {
    if (saving) return
    setSaving(true)
    const profile: ProviderProfile = {
      id: 'legacy-default', name: `${selectedProvider} (current)`, provider: selectedProvider,
      apiKey: updated['DEEPSEEK_API_KEY'], baseURL: updated['DEEPSEEK_BASE_URL'],
      awsRegion: updated['AWS_REGION'], awsProfile: updated['AWS_PROFILE'],
      gcpProject: updated['GCP_PROJECT'], gcpLocation: updated['GCP_LOCATION'], gcpCredentials: updated['GCP_CREDENTIALS'],
      localBaseUrl: updated['LOCAL_BASE_URL'], localModel: updated['LOCAL_MODEL'], model: updated['LOCAL_MODEL'],
    }
    Promise.all([
      saveConfig(Object.fromEntries(Object.entries(updated).filter(([key]) => key === 'DEEPSEEK_API_KEY' || key === 'GCP_CREDENTIALS'))),
      loadProviderProfiles().then(existing => saveProviderProfiles([...existing.filter(entry => entry.id !== profile.id), profile])),
      saveUserSettings({
        provider: {
          name: selectedProvider,
          activeProfileId: profile.id,
          endpoint: updated['DEEPSEEK_BASE_URL'] || updated['LOCAL_BASE_URL'] || undefined,
          region: updated['AWS_REGION'] || undefined,
          profile: updated['AWS_PROFILE'] || undefined,
          projectId: updated['GCP_PROJECT'] || undefined,
          location: updated['GCP_LOCATION'] || undefined,
        },
        interface: { theme: selectedTheme },
      }),
    ])
      .then(() => {
        for (const [k, v] of Object.entries(updated)) if (v) process.env[k] = v
        setStep('done')
        setDonePayload({
          theme: selectedTheme,
          config: {
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
          },
        })
      })
      .catch((e: unknown) => setError(`Failed to save: ${(e as Error).message}`))
      .finally(() => setSaving(false))
  }

  useEffect(() => {
    if (donePayload) {
      const t = setTimeout(() => onDone(donePayload.theme, donePayload.config), 50)
      return () => clearTimeout(t)
    }
  }, [donePayload, onDone])

  useInput((input: string, key: Key) => {
    if (key.ctrl && input === 'c') process.exit(0)
    if (saving) return

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
        setFieldIdx(0); setFieldValues({}); setCurrentInput(''); setShowCustomBaseUrl(false); setBaseUrlNotice(null); setStep('fields')
        return
      }
      if (key.escape) { setStep('theme'); return }
      return
    }

    if (step === 'fields') {
      if (checkingHealth || saving) return
      if (key.return) {
        const trimmed = currentInput.trim()
        if (!trimmed && !currentField!.optional) { setError(`${currentField!.label} cannot be empty.`); return }
        if (!trimmed && currentField!.key === 'DEEPSEEK_BASE_URL' && baseUrlNotice?.required) {
          setError('Enter the base URL of the proxy or gateway this key belongs to.')
          return
        }
        const updated = { ...fieldValues, [currentField!.key]: trimmed }
        setFieldValues(updated)
        setError('')
        if (selectedProvider === 'deepseek' && currentField!.key === 'DEEPSEEK_API_KEY') {
          setCheckingHealth(true)
          void checkOfficialDeepSeekApi(trimmed).then((health) => {
            const outcome = afterKeyCheck(health)
            if (outcome.next === 'error') {
              setError(outcome.message)
              return
            }
            if (outcome.next === 'baseUrl') {
              setBaseUrlNotice({ required: outcome.required, text: outcome.notice })
              setShowCustomBaseUrl(true)
              setFieldIdx(1)
              setCurrentInput(fieldValues.DEEPSEEK_BASE_URL ?? '')
              return
            }
            completeSetup(updated)
          }).finally(() => setCheckingHealth(false))
          return
        }
        if (fieldIdx < fields.length - 1) {
          setFieldIdx((i) => i + 1)
          setCurrentInput('')
        } else completeSetup(updated)
        return
      }
      if (key.backspace) { setCurrentInput((s) => s.slice(0, -1)); setError(''); return }
      if (key.escape) {
        if (fieldIdx > 0) {
          setFieldIdx((i) => i - 1); setCurrentInput(fieldValues[fields[fieldIdx - 1]!.key] ?? ''); setError('')
          // Back on the key field: the next Enter checks the key again from scratch.
          if (selectedProvider === 'deepseek' && fieldIdx === 1) { setBaseUrlNotice(null); setShowCustomBaseUrl(false) }
        }
        else { setStep('provider'); setCurrentInput(''); setError('') }
        return
      }
      // Ctrl+Shift+V: paste from clipboard
      if (key.ctrl && key.shift && input === 'v') {
        try {
          const text = readClipboardSync().trim()
          if (text) { setCurrentInput((s) => s + text); setError('') }
        } catch { /* clipboard not available */ }
        return
      }
      if (!key.ctrl && !key.meta && input && input.length >= 1) { setCurrentInput((s) => s + input); setError('') }
    }
  })

  const colors = getThemeColors(selectedTheme)

  if (step === 'done') {
    return <Box marginTop={1}><Text color={colors.success}>{'✓ Saved! Starting DeepSeek Code…'}</Text></Box>
  }

  let content: React.ReactNode = null

  if (step === 'theme') {
    content = (
      <Box flexDirection="column" marginTop={1}>
        <Text>Choose the text style that looks best with your terminal:</Text>
        <Box flexDirection="row" marginTop={1} gap={3}>
          {/* Theme list (left) */}
          <Box flexDirection="column">
            {THEMES.map((t, i) => (
              <Box key={t.value}>
                <Text color={i === themeIdx ? colors.primary : undefined}>{i === themeIdx ? '❯ ' : '  '}{t.label}</Text>
              </Box>
            ))}
          </Box>

          {/* Separator */}
          <Box flexDirection="column">
            {Array.from({ length: THEMES.length }).map((_, i) => (
              <Text key={i} color={colors.rule}>{'│'}</Text>
            ))}
          </Box>

          {/* Diff preview (right) */}
          <Box flexDirection="column">
            <Text color={colors.textSubtle} italic>{'Preview — demo.js'}</Text>
            <Text color={colors.textDim}>{' function greet() {'}</Text>
            <Text backgroundColor={colors.diffRemoved} color={colors.diffRemovedWord}>{'-  console.log("Hello, World!");'}</Text>
            <Text backgroundColor={colors.diffAdded} color={colors.diffAddedWord}>{'+  console.log("Hello, DeepSeek!");'}</Text>
            <Text color={colors.textDim}>{' }'}</Text>
          </Box>
        </Box>
        <Text color={colors.textDim}>{'↑↓ navigate · Enter select · Esc exit'}</Text>
      </Box>
    )
  } else if (step === 'provider') {
    content = (
      <Box flexDirection="column" marginTop={1}>
        <Text>Choose your AI provider:</Text>
        <Box flexDirection="column" marginTop={1}>
          {PROVIDERS.map((p, i) => (
            <Box key={p.value} flexDirection="row" gap={2}>
              <Text color={i === providerIdx ? colors.primary : undefined}>{i === providerIdx ? '❯ ' : '  '}{p.label}</Text>
              <Text color={colors.textDim}>{p.hint}</Text>
            </Box>
          ))}
        </Box>
        <Text color={colors.textDim}>{'↑↓ navigate · Enter select · Esc back'}</Text>
      </Box>
    )
  } else if (step === 'fields') {
    const progress = `(${fieldIdx + 1}/${fields.length})`
    content = (
      <Box flexDirection="column" marginTop={1}>
        <Text>{PROVIDERS[providerIdx]!.label + ' setup ' + progress}</Text>
        <Text>{currentField!.key === 'DEEPSEEK_BASE_URL' && baseUrlNotice?.required ? 'Base URL' : currentField!.label}</Text>
        {currentField!.key === 'DEEPSEEK_BASE_URL' && baseUrlNotice
          ? <Text color={colors.warning}>{baseUrlNotice.text}</Text>
          : currentField!.hint ? <Text color={colors.textDim}>{currentField!.hint}</Text> : null}
        <Box marginTop={1}>
          <Text color={colors.primary}>{'> '}</Text>
          <Text>{currentField!.secret ? '•'.repeat(currentInput.length) : currentInput}</Text>
          <Text color={colors.primary}>{'█'}</Text>
        </Box>
        {saving ? <Text color={colors.textDim}>Saving…</Text> : checkingHealth ? <Text color={colors.textDim}>Checking the official DeepSeek API…</Text> : error ? <Text color={colors.error}>{error}</Text> : <Text color={colors.textDim}>{'Enter to confirm · Esc back'}</Text>}
      </Box>
    )
  }

  return (
    <Box flexDirection="column" paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1}>
      <WelcomeScreen theme={selectedTheme}>{content}</WelcomeScreen>
    </Box>
  )
}
