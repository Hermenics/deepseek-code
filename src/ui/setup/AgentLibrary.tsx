import { useEffect, useState } from 'react'
import { execa } from 'execa'
import useInput from '../../ink/hooks/use-input.js'
import type { Key } from '../../ink/events/input-event.js'
import Box from '../../ink/components/Box.js'
import Text from '../../ink/components/Text.js'
import { withInkPaused } from '../../ink/root.js'
import { editPromptMarkdown } from './promptEditor.js'
import { getThemeColors } from '../theme.js'
import type { ThemeName } from '../../types/provider.js'
import type { SettingsLevel } from '../../settings/types.js'
import { SettingsRepository } from '../../settings/repository.js'
import {
  deleteAgentConfig,
  duplicateAgent,
  getAgentConfigPath,
  loadAgentRegistry,
  saveAgentConfig,
  type LoadedAgent,
} from '../../agent/config.js'

interface Props {
  scope: SettingsLevel
  theme: ThemeName
  onBack(): void
  onChanged(): void
}

type PromptMode = 'create' | 'duplicate' | null

export default function AgentLibrary({ scope, theme, onBack, onChanged }: Props) {
  const colors = getThemeColors(theme)
  const [agents, setAgents] = useState<LoadedAgent[]>([])
  const [index, setIndex] = useState(0)
  const [usage, setUsage] = useState<'all' | 'primary' | 'subagent'>('all')
  const [origin, setOrigin] = useState<'all' | LoadedAgent['origin']>('all')
  const [promptMode, setPromptMode] = useState<PromptMode>(null)
  const [input, setInput] = useState('')
  const [status, setStatus] = useState('n new · e edit JSON · p edit prompt · d disable/delete · c duplicate · r restore')

  const reload = async () => {
    try { setAgents(await loadAgentRegistry()); onChanged() } catch (error) { setStatus(`Error: ${(error as Error).message}`) }
  }
  useEffect(() => { void reload() }, [])

  const filtered = agents.filter(agent => {
    const agentUsage = agent.config.usage ?? 'primary'
    return (usage === 'all' || agentUsage === usage || agentUsage === 'both') && (origin === 'all' || agent.origin === origin)
  })
  const selected = filtered[Math.min(index, Math.max(0, filtered.length - 1))]

  const openEditor = async () => {
    if (!selected) return
    const editor = process.env.VISUAL || process.env.EDITOR
    if (!editor) { setStatus('Set $VISUAL or $EDITOR first'); return }
    const path = getAgentConfigPath(scope, selected.config.name)
    try {
      if (selected.origin !== scope) {
        await saveAgentConfig(scope, { name: selected.config.name, extends: selected.origin === 'builtin' ? `builtin:${selected.config.name}` : selected.config.name })
      }
      await withInkPaused(() => execa(editor, [path], { stdio: 'inherit' }).then(() => undefined))
      await reload()
      setStatus('Agent saved and registry reloaded')
    } catch (error) { setStatus(`Editor error: ${(error as Error).message}`) }
  }

  useInput((text: string, key: Key) => {
    if (promptMode) {
      if (key.escape) { setPromptMode(null); setInput(''); return }
      if (key.backspace || key.delete) { setInput(value => value.slice(0, -1)); return }
      if (key.return) {
        const value = input.trim()
        if (!value) { setStatus('A value is required'); return }
        void (async () => {
          try {
            if (promptMode === 'create') {
              await saveAgentConfig(scope, {
                name: value,
                description: 'Custom DeepSeek Code agent',
                usage: 'both',
                role: 'executor',
                enabled: true,
                systemPrompt: 'Handle the assigned task precisely. Read relevant files first and follow existing project conventions.',
              })
              setStatus(`Created ${value} · press e to edit all fields`)
            } else if (promptMode === 'duplicate' && selected) {
              await duplicateAgent(selected.config.name, value, scope)
              setStatus(`Duplicated as ${value}`)
            }
            await reload()
          } catch (error) { setStatus(`Error: ${(error as Error).message}`) }
          setPromptMode(null); setInput('')
        })()
        return
      }
      if (text && !key.ctrl && !key.meta) setInput(value => value + text)
      return
    }
    if (key.escape || text === 'q') { onBack(); return }
    if (key.upArrow || text === 'k') { setIndex(value => (value - 1 + filtered.length) % Math.max(1, filtered.length)); return }
    if (key.downArrow || text === 'j') { setIndex(value => (value + 1) % Math.max(1, filtered.length)); return }
    if (text === 'n') { setPromptMode('create'); setInput(''); setStatus('New agent name'); return }
    if (text === 'c' && selected) { setPromptMode('duplicate'); setInput(`${selected.config.name}-copy`); setStatus('Duplicate name'); return }
    if (text === 'p' && selected) {
      void editPromptMarkdown(`${selected.config.name}-prompt`, selected.config.systemPrompt)
        .then(systemPrompt => saveAgentConfig(scope, { ...selected.config, systemPrompt }))
        .then(reload)
        .then(() => setStatus('Specialization prompt saved'))
        .catch(error => setStatus(`Editor error: ${error.message}`))
      return
    }
    if (text === 'e' && selected) { void openEditor(); return }
    if (text === 'u') {
      const values = ['all', 'primary', 'subagent'] as const
      setUsage(current => values[(values.indexOf(current) + 1) % values.length]!); setIndex(0); return
    }
    if (text === 'o') {
      const values: Array<'all' | LoadedAgent['origin']> = ['all', 'builtin', 'user', 'additional', 'project', 'local']
      setOrigin(current => values[(values.indexOf(current) + 1) % values.length]!); setIndex(0); return
    }
    if (text === 'r' && selected) {
      void (async () => {
        if (selected.origin === 'builtin') {
          const repository = new SettingsRepository()
          const snapshot = await repository.getSnapshot()
          const disabled = snapshot.levels[scope].data.agents?.disabledBuiltins ?? []
          const restored = disabled.filter(name => name !== selected.config.name)
          if (restored.length) await repository.set(scope, 'agents.disabledBuiltins', restored)
          else await repository.unset(scope, 'agents.disabledBuiltins')
        } else await deleteAgentConfig(scope, selected.config.name)
        await reload()
        setStatus('Scoped override removed · inherited definition restored')
      })().catch(error => setStatus(`Error: ${error.message}`))
      return
    }
    if ((text === 'd' || text === ' ') && selected) {
      void (async () => {
        try {
          if (selected.origin === scope) await deleteAgentConfig(scope, selected.config.name)
          else if (selected.origin === 'builtin') {
            const repository = new SettingsRepository()
            const snapshot = await repository.getSnapshot()
            const disabled = [...new Set([...(snapshot.effective.agents?.disabledBuiltins ?? []), selected.config.name])]
            await repository.set(scope, 'agents.disabledBuiltins', disabled)
          } else await saveAgentConfig(scope, { ...selected.config, enabled: false })
          await reload(); setStatus(selected.origin === scope ? 'Agent removed from this scope' : 'Agent disabled in this scope')
        } catch (error) { setStatus(`Error: ${(error as Error).message}`) }
      })()
    }
  })

  const max = Math.max(4, (process.stdout.rows || 24) - 11)
  const start = Math.max(0, Math.min(index - Math.floor(max / 2), Math.max(0, filtered.length - max)))
  const visible = filtered.slice(start, start + max)

  return (
    <Box flexDirection="column" width={process.stdout.columns || 80} height={process.stdout.rows || 24} paddingX={1}>
      <Box justifyContent="space-between"><Text bold color={colors.primary}>Settings / Agents</Text><Text dimColor>Scope: {scope}</Text></Box>
      <Text dimColor>usage: {usage} · origin: {origin} · u/o change filters</Text>
      <Box marginTop={1} flexGrow={1}>
        <Box flexDirection="column" width={Math.min(38, Math.max(24, Math.floor((process.stdout.columns || 80) * .42)))}>
          {start > 0 ? <Text dimColor>  ↑ {start} above</Text> : null}
          {visible.map((agent, offset) => {
            const active = start + offset === index
            return <Box key={`${agent.origin}:${agent.config.name}`} justifyContent="space-between"><Text bold={active} color={active ? colors.primary : colors.text}>{active ? '› ' : '  '}{agent.config.name}</Text><Text dimColor>{agent.config.enabled === false ? 'disabled' : agent.origin}</Text></Box>
          })}
          {start + visible.length < filtered.length ? <Text dimColor>  ↓ {filtered.length - start - visible.length} below</Text> : null}
        </Box>
        {selected ? <Box flexDirection="column" flexGrow={1} paddingLeft={2}>
          <Text bold>{selected.config.name}</Text>
          <Text>{selected.config.description ?? 'No description'}</Text>
          <Box marginTop={1} flexDirection="column">
            <Text dimColor>Use: {selected.config.usage ?? 'primary'} · Role: {selected.config.role ?? '—'} · Model: {selected.config.model ?? 'inherited'}</Text>
            <Text dimColor>Tools: {Array.isArray(selected.config.tools) ? selected.config.tools.join(', ') : selected.config.tools ?? 'role defaults'}</Text>
            <Text dimColor>Origin: {selected.origin}{selected.overridden ? ' · override' : ''}</Text>
          </Box>
          <Box marginTop={1} flexDirection="column"><Text dimColor>Specialization prompt</Text><Text wrap="wrap">{selected.config.systemPrompt.replace(/\s+/g, ' ').slice(0, 320)}{selected.config.systemPrompt.length > 320 ? '…' : ''}</Text></Box>
          <Box marginTop={1} flexDirection="column"><Text dimColor>Protected protocol</Text><Text color={colors.textDim}>summary · confidence · filesRead · filesChanged · issuesFound · suggestions · metadata</Text></Box>
        </Box> : <Text dimColor>No agents match these filters.</Text>}
      </Box>
      {promptMode ? <Box flexDirection="column"><Text color={colors.primary}>{status}</Text><Text>{input || '…'}<Text color={colors.primary}>█</Text></Text><Text dimColor>Enter save · Esc cancel</Text></Box> : <><Text color={status.startsWith('Error') ? colors.error : colors.textDim} wrap="truncate-end">{status}</Text><Text dimColor>↑↓ navigate · n new · e JSON · p prompt · c copy · d disable/delete · r restore · Esc back</Text></>}
    </Box>
  )
}
