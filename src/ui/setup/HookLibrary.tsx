import { randomUUID } from 'crypto'
import { useEffect, useState } from 'react'
import useInput from '../../ink/hooks/use-input.js'
import type { Key } from '../../ink/events/input-event.js'
import Box from '../../ink/components/Box.js'
import Text from '../../ink/components/Text.js'
import { getThemeColors } from '../theme.js'
import type { ThemeName } from '../../types/provider.js'
import type { SettingsLevel } from '../../settings/types.js'
import { SettingsRepository } from '../../settings/repository.js'
import { runHookCommand } from '../../hooks/executor.js'
import type { HookCommand, HookEvent, HooksConfig } from '../../hooks/types.js'

interface Props { scope: SettingsLevel; theme: ThemeName; onBack(): void }
interface FlatHook { event: HookEvent; matcher: string; matcherId?: string; matcherEnabled?: boolean; command: HookCommand }
type EditMode = 'new' | 'command' | 'matcher' | 'timeout' | null
let hookTestSessionConfirmed = false

const MATCHER_EVENTS = [
  'PreToolUse', 'PostToolUse', 'PermissionRequest', 'SubagentStart', 'SubagentStop',
  'SessionStart', 'Setup', 'SessionEnd', 'PreCompact', 'PostCompact',
  'InstructionsLoaded', 'UserPromptExpansion', 'PostToolUseFailure', 'PermissionDenied',
  'Notification', 'StopFailure', 'ConfigChange', 'DirectoryAdded', 'FileChanged',
  'Elicitation', 'ElicitationResult',
] as const
const COMMAND_EVENTS = [
  'UserPromptSubmit', 'Stop', 'MessageDisplay', 'PostToolBatch', 'TaskCreated', 'TaskCompleted', 'TeammateIdle',
  'CwdChanged', 'WorktreeCreate', 'WorktreeRemove',
] as const

function isMatcherEvent(event: HookEvent): event is typeof MATCHER_EVENTS[number] {
  return (MATCHER_EVENTS as readonly string[]).includes(event)
}

function flatten(config: HooksConfig | undefined): FlatHook[] {
  const result: FlatHook[] = []
  for (const event of MATCHER_EVENTS) {
    for (const matcher of config?.[event] ?? []) {
      for (const command of matcher.hooks) result.push({ event, matcher: matcher.matcher, matcherId: matcher.id, matcherEnabled: matcher.enabled, command })
    }
  }
  for (const event of COMMAND_EVENTS) {
    for (const command of config?.[event] ?? []) result.push({ event, matcher: '—', command })
  }
  return result
}

function unflatten(items: FlatHook[]): HooksConfig {
  const config: HooksConfig = {}
  for (const item of items) {
    if (!isMatcherEvent(item.event)) {
      config[item.event] = [...(config[item.event] ?? []), item.command]
      continue
    }
    const matchers = config[item.event] ?? []
    let matcher = matchers.find(entry => item.matcherId ? entry.id === item.matcherId : entry.matcher === item.matcher)
    if (!matcher) {
      matcher = { id: item.matcherId ?? `matcher-${randomUUID().slice(0, 8)}`, matcher: item.matcher, enabled: item.matcherEnabled ?? true, hooks: [] }
      matchers.push(matcher)
    }
    matcher.hooks.push(item.command)
    config[item.event] = matchers
  }
  return config
}

export { flatten as flattenHooks, unflatten as unflattenHooks }

export default function HookLibrary({ scope, theme, onBack }: Props) {
  const colors = getThemeColors(theme)
  const [repository] = useState(() => new SettingsRepository())
  const [hooks, setHooks] = useState<FlatHook[]>([])
  const [ignoredCount, setIgnoredCount] = useState(0)
  const [index, setIndex] = useState(0)
  const [editMode, setEditMode] = useState<EditMode>(null)
  const [input, setInput] = useState('')
  const [confirmTest, setConfirmTest] = useState(false)
  const [sessionConfirmed, setSessionConfirmed] = useState(hookTestSessionConfirmed)
  const [status, setStatus] = useState('n new · e command · m matcher · v event · Space enable · t test · d delete')
  const selected = hooks[Math.min(index, Math.max(0, hooks.length - 1))]

  const reload = async () => {
    const snapshot = await repository.reload()
    setHooks(flatten(snapshot.levels.user.data.hooks))
    const ignored = flatten(snapshot.levels.project.data.hooks).length + flatten(snapshot.levels.local.data.hooks).length
    setIgnoredCount(ignored)
  }
  useEffect(() => { void reload() }, [scope])

  const persist = async (next: FlatHook[], message: string) => {
    try {
      await repository.set('user', 'hooks', unflatten(next))
      setHooks(next)
      setIndex(value => Math.min(value, Math.max(0, next.length - 1)))
      setStatus(message)
    } catch (error) { setStatus(`Error: ${(error as Error).message}`) }
  }

  const test = async (remember: boolean) => {
    if (!selected) return
    setConfirmTest(false)
    if (remember) {
      hookTestSessionConfirmed = true
      setSessionConfirmed(true)
    }
    const started = Date.now()
    const { buildInput } = await import('../../hooks/executor.js')
    const output = await runHookCommand(selected.command, buildInput({
      event: selected.event,
      session_id: 'settings-preview',
      tool_name: isMatcherEvent(selected.event) ? 'read_file' : undefined,
      tool_input: isMatcherEvent(selected.event) ? { path: 'README.md', simulated: true } : undefined,
      tool_result: selected.event === 'PostToolUse' ? 'simulated result' : undefined,
    }))
    setStatus(`Test ${output ? `output: ${output}` : 'completed'} · ${Date.now() - started}ms`)
  }

  useInput((text: string, key: Key) => {
    if (confirmTest) {
      if (text === '1') void test(false)
      else if (text === '2') void test(true)
      else if (text.toLowerCase() === 'c' || key.escape) { setConfirmTest(false); setStatus('Test cancelled') }
      return
    }
    if (editMode) {
      if (key.escape) { setEditMode(null); setInput(''); return }
      if (key.backspace || key.delete) { setInput(value => value.slice(0, -1)); return }
      if (key.return) {
        if (!input.trim()) { setStatus('A non-empty value is required'); return }
        if (editMode === 'new') void persist([...hooks, { event: 'PreToolUse', matcher: '*', matcherId: `matcher-${randomUUID().slice(0, 8)}`, matcherEnabled: true, command: { id: `hook-${randomUUID().slice(0, 8)}`, type: 'command', command: input, timeout: 30, enabled: true } }], 'Hook created for PreToolUse(*)')
        else if (selected) {
          const next = hooks.map((hook, itemIndex) => {
            if (itemIndex !== index) return hook
            if (editMode === 'command') return { ...hook, command: { ...hook.command, command: input } }
            if (editMode === 'timeout') return { ...hook, command: { ...hook.command, timeout: Number(input) } }
            return { ...hook, matcher: input }
          })
          void persist(next, editMode === 'command' ? 'Command updated' : editMode === 'timeout' ? 'Timeout updated' : 'Matcher updated')
        }
        setEditMode(null); setInput(''); return
      }
      if (text && !key.ctrl && !key.meta) setInput(value => value + text)
      return
    }
    if (key.escape || text === 'q') { onBack(); return }
    if (scope !== 'user') { setStatus('Project and Local hooks are ignored. Switch to User scope to edit executable hooks.'); return }
    if (key.upArrow || text === 'k') { setIndex(value => (value - 1 + hooks.length) % Math.max(1, hooks.length)); return }
    if (key.downArrow || text === 'j') { setIndex(value => (value + 1) % Math.max(1, hooks.length)); return }
    if (text === 'n') { setEditMode('new'); setInput(''); setStatus('Command for new PreToolUse(*) hook'); return }
    if (text === 'e' && selected) { setEditMode('command'); setInput(selected.command.command); setStatus('Edit command'); return }
    if (text === 'm' && selected && isMatcherEvent(selected.event)) { setEditMode('matcher'); setInput(selected.matcher); setStatus('Edit matcher'); return }
    if (text === 'x' && selected) { setEditMode('timeout'); setInput(String(selected.command.timeout ?? 30)); setStatus('Timeout in seconds'); return }
    if (text === 'd' && selected) { void persist(hooks.filter((_, itemIndex) => itemIndex !== index), 'Hook removed'); return }
    if (text === ' ' && selected) {
      void persist(hooks.map((hook, itemIndex) => itemIndex === index ? { ...hook, command: { ...hook.command, enabled: hook.command.enabled === false } } : hook), selected.command.enabled === false ? 'Hook enabled' : 'Hook disabled')
      return
    }
    if (text === 'v' && selected) {
      const events: HookEvent[] = [...MATCHER_EVENTS, ...COMMAND_EVENTS]
      const event = events[(events.indexOf(selected.event) + 1) % events.length]!
      void persist(hooks.map((hook, itemIndex) => itemIndex === index ? { ...hook, event, matcher: isMatcherEvent(event) ? hook.matcher === '—' ? '*' : hook.matcher : '—' } : hook), `Event changed to ${event}`)
      return
    }
    if (text === 't' && selected) {
      if (sessionConfirmed) void test(false)
      else { setConfirmTest(true); setStatus('Run executable hook with a simulated payload?') }
    }
  })

  const max = Math.max(4, (process.stdout.rows || 24) - 10)
  const start = Math.max(0, Math.min(index - Math.floor(max / 2), Math.max(0, hooks.length - max)))
  const visible = hooks.slice(start, start + max)
  return (
    <Box flexDirection="column" width={process.stdout.columns || 80} height={process.stdout.rows || 24} paddingX={1}>
      <Box justifyContent="space-between"><Text bold color={colors.primary}>Settings / Hooks</Text><Text dimColor>Executable scope: User</Text></Box>
      {scope !== 'user' || ignoredCount > 0 ? <Text color={colors.warning}>△ Project and Local hooks are ignored for security{ignoredCount ? ` · ${ignoredCount} found` : ''}</Text> : <Text dimColor>Old hooks are treated as enabled and receive stable IDs when loaded.</Text>}
      <Box marginTop={1} flexGrow={1}>
        <Box flexDirection="column" width={Math.min(48, Math.max(30, Math.floor((process.stdout.columns || 80) * .55)))}>
          {visible.map((hook, offset) => {
            const active = start + offset === index
            return <Box key={`${hook.command.id ?? offset}`} justifyContent="space-between"><Text bold={active} color={active ? colors.primary : colors.text} wrap="truncate-end">{active ? '› ' : '  '}{hook.event}({hook.matcher})</Text><Text dimColor>{hook.command.enabled === false ? 'OFF' : 'ON'}</Text></Box>
          })}
          {!visible.length ? <Text dimColor>No User hooks configured.</Text> : null}
        </Box>
        {selected ? <Box flexDirection="column" flexGrow={1} paddingLeft={2}><Text bold>{selected.event}</Text><Text dimColor>ID: {selected.command.id ?? 'legacy · assigned on reload'}</Text><Text dimColor>Matcher: {selected.matcher} · Timeout: {selected.command.timeout ?? 30}s</Text><Box marginTop={1}><Text wrap="wrap">{selected.command.command}</Text></Box></Box> : null}
      </Box>
      {confirmTest ? <Box flexDirection="column"><Text color={colors.warning}>{status}</Text><Text>1 Confirm once · 2 Confirm for session · c Cancel</Text></Box> : editMode ? <Box flexDirection="column"><Text color={colors.primary}>{status}</Text><Text>{input || '…'}<Text color={colors.primary}>█</Text></Text><Text dimColor>Enter save · Esc cancel</Text></Box> : <><Text color={status.startsWith('Error') ? colors.error : colors.textDim} wrap="truncate-end">{status}</Text><Text dimColor>↑↓ navigate · n new · e command · m matcher · x timeout · v event · Space toggle · t test · d delete · Esc back</Text></>}
    </Box>
  )
}
