import { useEffect, useMemo, useState } from 'react'
import useInput from '../../ink/hooks/use-input.js'
import type { Key } from '../../ink/events/input-event.js'
import Box from '../../ink/components/Box.js'
import Text from '../../ink/components/Text.js'
import { getThemeColors } from '../theme.js'
import type { ProviderConfig, ProviderName, ThemeName } from '../../types/provider.js'
import { SettingsRepository } from '../../settings/repository.js'
import { createProviderProfile, loadProviderProfiles, saveProviderProfiles, type ProviderProfile } from '../../utils/providerProfiles.js'

const PROVIDERS: ProviderName[] = ['deepseek', 'bedrock', 'vertex', 'local']
type Field = { key: keyof ProviderProfile; label: string; secret?: boolean; kind?: 'provider' }
const PROVIDER_LABELS: Record<ProviderName, string> = {
  deepseek: 'DeepSeek API', bedrock: 'AWS Bedrock', vertex: 'Google Vertex AI', local: 'Local model (no API key)',
}

/**
 * Both 'deepseek' and 'local' speak the OpenAI protocol, and both are
 * commonly pointed at localhost, so naming either one after where it runs
 * tells nobody anything. What separates them is whether a credential goes
 * out with the request: 'local' deliberately sends none, which is right for
 * Ollama and wrong for any proxy that answers 401.
 */
const PROVIDER_HINTS: Record<ProviderName, string> = {
  deepseek: 'DeepSeek, or any OpenAI-compatible endpoint that needs an API key — set Base URL for a proxy.',
  bedrock: 'DeepSeek models hosted on AWS Bedrock, authenticated through your AWS profile.',
  vertex: 'DeepSeek models on Google Vertex AI, authenticated with a service account.',
  local: 'A server that needs no credentials, such as Ollama or LM Studio. No API key is sent.',
}

function hintFor(field?: Field): string {
  switch (field?.key) {
    case 'name': return 'Use a short name you will recognize, such as Work or Local.'
    case 'provider': return 'Enter cycles through supported provider types.'
    case 'model': return 'Optional. Leave empty to use this provider’s default model.'
    case 'apiKey': return 'API key from your DeepSeek account, or the key your OpenAI-compatible proxy expects.'
    case 'baseURL': return 'Optional. Point at an OpenAI-compatible proxy; a host with no path is treated as /v1.'
    case 'awsRegion': return 'AWS Bedrock region, for example us-east-1.'
    case 'awsProfile': return 'Optional AWS CLI profile name; defaults to default.'
    case 'gcpProject': return 'Google Cloud project ID.'
    case 'gcpLocation': return 'Vertex AI location, for example us-central1.'
    case 'gcpCredentials': return 'Path to the service account JSON file.'
    case 'localBaseUrl': return 'Endpoint that needs no credentials, for example http://localhost:11434/v1.'
    case 'localModel': return 'Optional model ID exposed by the local server.'
    default: return ''
  }
}

/** Editable fields for a profile: name/provider/model plus the credential fields specific to its provider type. */
function fieldsFor(profile: ProviderProfile): Field[] {
  const common: Field[] = [
    { key: 'name', label: 'Profile name' },
    { key: 'provider', label: 'Provider', kind: 'provider' },
    { key: 'model', label: 'Preferred model' },
  ]
  if (profile.provider === 'deepseek') return [...common, { key: 'apiKey', label: 'API key', secret: true }, { key: 'baseURL', label: 'Base URL' }]
  if (profile.provider === 'bedrock') return [...common, { key: 'awsRegion', label: 'AWS region' }, { key: 'awsProfile', label: 'AWS profile' }]
  if (profile.provider === 'vertex') return [...common, { key: 'gcpProject', label: 'GCP project' }, { key: 'gcpLocation', label: 'GCP location' }, { key: 'gcpCredentials', label: 'Service account path', secret: true }]
  return [...common, { key: 'localBaseUrl', label: 'Base URL' }, { key: 'localModel', label: 'Local model' }]
}

/** Returns the first validation error that blocks activating or testing the profile (missing name or required credentials), or null when it is usable. */
function profileProblem(profile: ProviderProfile): string | null {
  if (!profile.name.trim()) return 'Profile name is required'
  if (profile.provider === 'deepseek' && !profile.apiKey) return 'Add a DeepSeek API key before activation or testing'
  if (profile.provider === 'bedrock' && !profile.awsRegion) return 'Add an AWS region before activation or testing'
  if (profile.provider === 'vertex' && (!profile.gcpProject || !profile.gcpCredentials)) return 'Add a GCP project and service account path before activation or testing'
  if (profile.provider === 'local' && !profile.localBaseUrl) return 'Add a base URL before activation or testing'
  return null
}

interface Props {
  theme: ThemeName
  activeProfileId?: string
  onBack(): void
  onActivate(profile: ProviderProfile): Promise<'active' | 'queued'>
  onTest(profile: ProviderConfig): Promise<string[]>
}

/** Settings screen listing saved provider profiles, where the user can add, edit, test the connection of and activate a profile. */
export default function ProviderProfiles({ theme, activeProfileId, onBack, onActivate, onTest }: Props) {
  const colors = getThemeColors(theme)
  const [profiles, setProfiles] = useState<ProviderProfile[]>([])
  const [selectedActiveId, setSelectedActiveId] = useState(activeProfileId)
  const [index, setIndex] = useState(0)
  const [draft, setDraft] = useState<ProviderProfile | null>(null)
  const [fieldIndex, setFieldIndex] = useState(0)
  const [editing, setEditing] = useState(false)
  const [input, setInput] = useState('')
  const [selectingProvider, setSelectingProvider] = useState(false)
  const [providerIndex, setProviderIndex] = useState(0)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('Select a profile or press n to add one')

  const reload = async () => {
    try { setProfiles(await loadProviderProfiles()) }
    catch (error) { setStatus(`Error: ${(error as Error).message}`) }
  }
  useEffect(() => { void reload() }, [])
  useEffect(() => { setSelectedActiveId(activeProfileId) }, [activeProfileId])

  const selected = profiles[Math.min(index, Math.max(0, profiles.length - 1))]
  const draftFields = useMemo(() => draft ? fieldsFor(draft) : [], [draft])
  const draftField = draftFields[Math.min(fieldIndex, Math.max(0, draftFields.length - 1))]

  const saveDraft = async () => {
    if (!draft || !draft.name.trim()) { setStatus('Profile name is required'); return }
    setBusy(true)
    try {
      const next = profiles.some(profile => profile.id === draft.id)
        ? profiles.map(profile => profile.id === draft.id ? draft : profile)
        : [...profiles, draft]
      await saveProviderProfiles(next)
      setProfiles(next)
      setIndex(Math.max(0, next.findIndex(profile => profile.id === draft.id)))
      setDraft(null)
      setEditing(false)
      setStatus(draft.id === selectedActiveId ? `Saved ${draft.name} · press a to apply the changes` : `Saved ${draft.name}`)
    } catch (error) { setStatus(`Error: ${(error as Error).message}`) }
    finally { setBusy(false) }
  }

  const activate = async (profile: ProviderProfile) => {
    const problem = profileProblem(profile)
    if (problem) { setStatus(problem); return }
    setBusy(true)
    try {
      const repository = new SettingsRepository()
      const before = await repository.reload()
      const previousId = before.levels.user.data.provider?.activeProfileId
      await repository.set('user', 'provider.activeProfileId', profile.id)
      try {
        const result = await onActivate(profile)
        setSelectedActiveId(profile.id)
        setStatus(result === 'queued' ? `Switch to ${profile.name} queued until this turn finishes` : `Active profile: ${profile.name}`)
      } catch (error) {
        if (previousId) await repository.set('user', 'provider.activeProfileId', previousId)
        else await repository.unset('user', 'provider.activeProfileId')
        setSelectedActiveId(previousId)
        throw error
      }
    } catch (error) {
      setStatus(`Error: ${(error as Error).message}`)
    } finally { setBusy(false) }
  }

  useInput((text: string, key: Key) => {
    if (key.ctrl && text === 'c') { process.exit(0); return }
    if (busy) return
    if (selectingProvider) {
      if (key.escape) { setSelectingProvider(false); return }
      if (key.upArrow) { setProviderIndex(value => (value - 1 + PROVIDERS.length) % PROVIDERS.length); return }
      if (key.downArrow) { setProviderIndex(value => (value + 1) % PROVIDERS.length); return }
      if (key.return) {
        const provider = PROVIDERS[providerIndex]!
        setDraft(createProviderProfile('', provider))
        setFieldIndex(0)
        setSelectingProvider(false)
        setStatus('Edit fields · press s to save · credentials are stored privately')
      }
      return
    }
    if (editing && draft) {
      if (key.escape) { setEditing(false); setInput(''); return }
      if (key.backspace || key.delete) { setInput(value => value.slice(0, -1)); return }
      if (key.return && draftField) {
        const value = input.trim()
        setDraft(current => current ? { ...current, [draftField.key]: draftField.key === 'name' ? value : value || undefined } : current)
        setEditing(false); setInput(''); return
      }
      if (text && !key.ctrl && !key.meta) setInput(value => value + text)
      return
    }
    if (draft) {
      if (key.escape) { setDraft(null); return }
      if (key.upArrow) { setFieldIndex(value => (value - 1 + draftFields.length) % draftFields.length); return }
      if (key.downArrow) { setFieldIndex(value => (value + 1) % draftFields.length); return }
      if (text === 's') { void saveDraft(); return }
      if (key.return && draftField) {
        if (draftField.kind === 'provider') {
          const nextProvider = PROVIDERS[(PROVIDERS.indexOf(draft.provider) + 1) % PROVIDERS.length]!
          setDraft(current => {
            if (!current) return current
            const next = { ...current, provider: nextProvider }
            for (const key of ['apiKey', 'baseURL', 'awsRegion', 'awsProfile', 'gcpProject', 'gcpLocation', 'gcpCredentials', 'localBaseUrl', 'localModel'] as const) delete next[key]
            return next
          })
          setFieldIndex(0)
        } else {
          setInput(String(draft[draftField.key] ?? ''))
          setEditing(true)
        }
      }
      return
    }
    if (confirmDelete) {
      if (text.toLowerCase() === 'y' && selected) {
        void (async () => {
          try {
            const next = profiles.filter(profile => profile.id !== selected.id)
            await saveProviderProfiles(next); setProfiles(next); setIndex(Math.max(0, index - 1)); setStatus(`Deleted ${selected.name}`)
          } catch (error) { setStatus(`Error: ${(error as Error).message}`) }
          setConfirmDelete(false)
        })()
      } else if (text.toLowerCase() === 'n' || key.escape) setConfirmDelete(false)
      return
    }
    if (key.escape || text === 'q') { onBack(); return }
    if (key.upArrow || text === 'k') { setIndex(value => (value - 1 + profiles.length) % Math.max(1, profiles.length)); return }
    if (key.downArrow || text === 'j') { setIndex(value => (value + 1) % Math.max(1, profiles.length)); return }
    if (text === 'n') { setProviderIndex(0); setSelectingProvider(true); setStatus('Choose provider type · ↑↓ then Enter'); return }
    if (text === 'e' && selected) { setDraft({ ...selected }); setFieldIndex(0); setStatus('Edit fields · press s to save · Esc cancels'); return }
    if (text === 'a' && selected) { void activate(selected); return }
    if (text === 't' && selected) {
      const problem = profileProblem(selected)
      if (problem) { setStatus(problem); return }
      setBusy(true); setStatus(`Testing ${selected.name}…`)
      void onTest(selected).then(models => setStatus(`Connected · ${models.length} model${models.length === 1 ? '' : 's'} found`))
        .catch(error => setStatus(`Connection failed: ${(error as Error).message}`)).finally(() => setBusy(false))
      return
    }
    if (text === 'd' && selected) {
      if (selected.id === selectedActiveId) { setStatus('Activate another profile before deleting this one'); return }
      setConfirmDelete(true); setStatus(`Delete ${selected.name}? Press y to confirm or n to cancel`)
    }
  })

  const max = Math.max(4, (process.stdout.rows || 24) - 11)
  const width = process.stdout.columns || 80
  const start = Math.max(0, Math.min(index - Math.floor(max / 2), Math.max(0, profiles.length - max)))
  const visible = profiles.slice(start, start + max)
  const valueFor = (profile: ProviderProfile, field: Field) => field.secret
    ? profile[field.key] ? '••••••••' : 'not set'
    : field.kind === 'provider' ? PROVIDER_LABELS[profile.provider] : String(profile[field.key] ?? '—')

  return (
    <Box flexDirection="column" width={process.stdout.columns || 80} height={process.stdout.rows || 24} paddingX={1}>
      <Box justifyContent="space-between"><Text bold color={colors.primary}>Settings / Provider profiles</Text><Text dimColor>{busy ? 'Working…' : `${profiles.length} profile${profiles.length === 1 ? '' : 's'}`}</Text></Box>
      <Text dimColor>Credentials stay in ~/.deepseek/provider-profiles.json with private file permissions.</Text>
      {selectingProvider ? <Box flexDirection="column" marginTop={1}>
        {PROVIDERS.map((provider, i) => <Text key={provider} bold={i === providerIndex} color={i === providerIndex ? colors.primary : colors.text}>{i === providerIndex ? '› ' : '  '}{PROVIDER_LABELS[provider]}</Text>)}
        <Text dimColor wrap="truncate-end">{PROVIDER_HINTS[PROVIDERS[providerIndex]!]}</Text>
      </Box> : draft ? <Box flexDirection="column" marginTop={1}>
        {draftFields.map((field, i) => <Box key={field.key} justifyContent="space-between"><Text bold={i === fieldIndex} color={i === fieldIndex ? colors.primary : colors.text}>{i === fieldIndex ? '› ' : '  '}{field.label}</Text><Text color={i === fieldIndex ? colors.primary : colors.textDim} flexShrink={0} wrap="truncate-end">{`  ${field.secret && !editing ? valueFor(draft, field) : i === fieldIndex && editing ? 'editing' : valueFor(draft, field)}`}</Text></Box>)}
        <Text dimColor wrap="truncate-end">{draftField?.key === 'provider' ? PROVIDER_HINTS[draft.provider] : hintFor(draftField)}</Text>
        {/* While a field is open, 's' is a character being typed, not a
            save key. Every hint about the surrounding form is therefore
            wrong in this state, so the form's line steps aside for the
            editor rather than stacking above it. */}
        {editing && draftField
          ? <Box flexDirection="column" marginTop={1}><Text color={colors.primary}>{draftField.label}</Text><Text>{(draftField.secret ? '•'.repeat(input.length) : input).slice(-(Math.max(12, width - 8)))}<Text color={colors.primary}>█</Text></Text></Box>
          : <Box marginTop={1}><Text dimColor wrap="truncate-end">Provider field cycles types · Enter edits · s saves · Esc cancels</Text></Box>}
      </Box> : <Box marginTop={1} flexGrow={1}>
        <Box flexDirection="column" width={width < 72 ? Math.max(1, width - 2) : Math.min(38, Math.max(24, Math.floor(width * .42)))}>
          {start > 0 ? <Text dimColor>↑ {start} above</Text> : null}
          {visible.map((profile, offset) => { const active = start + offset === index; return <Box key={profile.id} width="100%" justifyContent="space-between"><Text bold={active} color={active ? colors.primary : colors.text} wrap="truncate-end">{active ? '› ' : '  '}{profile.name}</Text><Text dimColor flexShrink={0} wrap="truncate-end">{`  ${profile.id === selectedActiveId ? 'active' : PROVIDER_LABELS[profile.provider]}`}</Text></Box> })}
          {profiles.length === 0 ? <Text dimColor>No profiles yet · press n to add one</Text> : null}
          {start + visible.length < profiles.length ? <Text dimColor>↓ {profiles.length - start - visible.length} below</Text> : null}
        </Box>
        {width >= 72 && selected ? <Box flexDirection="column" flexGrow={1} paddingLeft={2}><Text bold>{selected.name}</Text><Text>Provider: {PROVIDER_LABELS[selected.provider]} · Model: {selected.model ?? selected.localModel ?? 'provider default'}</Text><Text dimColor>Endpoint: {selected.baseURL ?? selected.localBaseUrl ?? 'provider default'}</Text></Box> : null}
      </Box>}
      {editing ? null : <Text color={status.startsWith('Error') || status.includes('failed') ? colors.error : colors.textDim} wrap="truncate-end">{status}</Text>}
      <Text dimColor wrap="truncate-end">{
        selectingProvider ? '↑↓ choose provider · Enter continue · Esc cancel'
        : editing ? 'Enter save field · Esc cancel field'
        : draft ? '↑↓ fields · Enter edit · s save · Esc cancel'
        : '↑↓ select · n new · e edit · a activate · t test · d delete · Esc back'
      }</Text>
    </Box>
  )
}
