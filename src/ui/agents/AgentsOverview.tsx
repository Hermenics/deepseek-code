import { useContext, useEffect, useState } from 'react'
import useInput from '../../ink/hooks/use-input.js'
import type { Key } from '../../ink/events/input-event.js'
import Box from '../../ink/components/Box.js'
import Text from '../../ink/components/Text.js'
import { TerminalSizeContext } from '../../ink/components/TerminalSizeContext.js'
import type { SessionData } from '../../agent/session.js'
import { getThemeColors, STATUS_ICONS, type ThemeName } from '../theme.js'
import {
  buildRows, displayCwd, filterCounts, FILTER_LABELS, FILTERS, groupLabel, GROUPING_LABELS, GROUPINGS,
  relativeAge, STATUS_LABELS, visibleRows, type OverviewRow, type OverviewStatus,
} from './overview.js'

type Mode = 'list' | 'search' | 'rename' | 'delete' | 'help'
type Line = { kind: 'group'; label: string } | { kind: 'row'; row: OverviewRow } | { kind: 'gap' }

const clip = (text: string, width: number) => width <= 0 ? '' : text.length <= width ? text : text.slice(0, Math.max(0, width - 1)) + '…'
const pad = (text: string, width: number) => clip(text, width).padEnd(width)
/** Keeps both ends of a long path (`/tmp/claude…/scratchpad`), as Codex does for group headers. */
const clipMiddle = (text: string, width: number) => {
  if (text.length <= width) return text
  const head = Math.ceil((width - 1) / 2)
  return text.slice(0, head) + '…' + text.slice(text.length - (width - 1 - head))
}
const HELP: [string, string][] = [
  ['↑/↓', 'move'], ['enter/→', 'open'], ['esc', 'back'], ['n', 'new session'], ['tab/shift+tab', 'filter by status'],
  ['g', 'group by project/status/model'], ['f', 'search'], ['r', 'rename'], ['backspace', 'delete'], ['?', 'help'],
]

/**
 * Codex-style agent command center: every session with a status tab bar, grouped rows and a details pane
 * on wide terminals. Opened with ← on an empty prompt; switching away from a busy session is refused
 * because DeepSeek has no background daemon to keep it running.
 */
export function AgentsOverview({ current, listSaved, theme, onOpen, onNew, onRename, onDelete, onClose }: {
  current: { session: SessionData; status: OverviewStatus }
  listSaved: () => Promise<SessionData[]>
  theme: ThemeName
  onOpen: (session: SessionData) => void
  onNew: () => void
  onRename: (session: SessionData, title: string) => Promise<void>
  onDelete: (session: SessionData) => Promise<void>
  onClose: () => void
}) {
  const colors = getThemeColors(theme)
  const size = useContext(TerminalSizeContext)
  const columns = size?.columns ?? process.stdout.columns ?? 100
  const terminalRows = size?.rows ?? process.stdout.rows ?? 30
  const [saved, setSaved] = useState<SessionData[] | null>(null)
  const [filter, setFilter] = useState(0)
  const [grouping, setGrouping] = useState(0)
  const [mode, setMode] = useState<Mode>('list')
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState('')
  const [selectedId, setSelectedId] = useState(current.session.id)
  const [notice, setNotice] = useState<string | null>(null)

  const reload = () => listSaved().then(setSaved, () => setSaved([]))
  useEffect(() => { void reload() }, [])

  const rows = buildRows(saved ?? [], current)
  const counts = filterCounts(rows)
  const shown = visibleRows(rows, { filter: FILTERS[filter]!, grouping: GROUPINGS[grouping]!, search: query })
  const index = Math.max(0, shown.findIndex(row => row.id === selectedId))
  const selected = shown[index]
  const busy = current.status === 'needs' || current.status === 'working'

  const open = (row: OverviewRow | undefined) => {
    if (!row) return
    if (row.current) return onClose()
    if (busy) return setNotice('Finish or stop the current turn first: this session would be cut off.')
    onOpen(row.session)
  }

  useInput((input: string, key: Key) => {
    setNotice(null)
    if (mode === 'help') { if (key.escape || input === '?' || input === 'q') setMode('list'); return }
    if (mode === 'delete') {
      if (input === 'y' && selected) {
        void onDelete(selected.session).then(reload, (error: Error) => setNotice(`Could not delete: ${error.message}`))
      }
      setMode('list')
      return
    }
    if (mode === 'search' || mode === 'rename') {
      const set = mode === 'search' ? setQuery : setDraft
      if (key.escape) { if (mode === 'search') setQuery(''); setMode('list'); return }
      if (key.return) {
        if (mode === 'rename' && selected && draft.trim()) void onRename(selected.session, draft.trim()).then(reload)
        if (mode === 'search') open(selected)
        setMode('list')
        return
      }
      if (key.backspace || key.delete) { set(value => value.slice(0, -1)); return }
      // Search still lets ↑/↓ pick among matches; rename keeps the row fixed.
      if (mode === 'rename' || !(key.upArrow || key.downArrow)) {
        if (input && !key.ctrl && !key.meta && !key.tab) set(value => value + input)
        return
      }
    }
    const move = (delta: number) => shown.length && setSelectedId(shown[(index + delta + shown.length) % shown.length]!.id)
    if (key.upArrow) return move(-1)
    if (key.downArrow) return move(1)
    if (key.pageUp || key.pageDown) {
      const next = Math.max(0, Math.min(shown.length - 1, index + (key.pageUp ? -10 : 10)))
      if (shown[next]) setSelectedId(shown[next]!.id)
      return
    }
    if (key.return || key.rightArrow) return open(selected)
    if (key.escape || (key.ctrl && input === 'c')) return onClose()
    if (key.tab) return setFilter(value => (value + (key.shift ? FILTERS.length - 1 : 1)) % FILTERS.length)
    if (input === 'g') return setGrouping(value => (value + 1) % GROUPINGS.length)
    if (input === 'f') return setMode('search')
    if (input === '?') return setMode('help')
    if (input === 'n') return busy ? setNotice('Finish or stop the current turn before starting a new session.') : onNew()
    if (input === 'r' && selected) { setDraft(selected.title); setQuery(''); return setMode('rename') }
    if ((key.backspace || key.delete) && selected) {
      return selected.current ? setNotice('The current session cannot be deleted.') : setMode('delete')
    }
  })

  const bodyWidth = Math.max(20, columns - 4)
  const withDetails = bodyWidth >= 90
  const listWidth = withDetails ? bodyWidth - 41 : bodyWidth
  const withMeta = listWidth >= 56
  const titleWidth = listWidth - 4 - (withMeta ? 20 : 0)
  const glyph = (status: OverviewStatus) => status === 'needs' || status === 'working' ? '●' : '○'
  const glyphColor: Record<OverviewStatus, string> = { needs: colors.error, working: colors.success, ready: colors.info, inactive: colors.textDim }

  // Group headers read `label  count`, or `label  n of total` when a tab or search hides some rows.
  const lines: Line[] = []
  const groupOf = (row: OverviewRow) => groupLabel(row, GROUPINGS[grouping]!)
  let previous: string | null = null
  for (const row of shown) {
    const label = groupOf(row)
    if (label !== previous) {
      const total = rows.filter(other => groupOf(other) === label).length
      const visible = shown.filter(other => groupOf(other) === label).length
      if (previous !== null) lines.push({ kind: 'gap' })
      const count = `  ${visible === total ? total : `${visible} of ${total}`}`
      lines.push({ kind: 'group', label: clipMiddle(label, Math.min(64, listWidth - count.length)) + count })
      previous = label
    }
    lines.push({ kind: 'row', row })
  }
  const viewport = Math.max(3, terminalRows - 8)
  const selectedLine = lines.findIndex(line => line.kind === 'row' && line.row.id === selected?.id)
  const start = Math.max(0, Math.min(selectedLine - Math.floor(viewport / 2), lines.length - viewport))
  const visibleLines = lines.slice(start, start + viewport)

  const renderRow = (row: OverviewRow) => {
    const isSelected = row.id === selected?.id
    const badge = row.current && titleWidth >= 14 ? '  current' : ''
    // One column always stays blank so a clipped title never runs into the Status column.
    const title = pad(clip(row.title, titleWidth - 1 - badge.length) + badge, titleWidth)
    const meta = withMeta ? pad(STATUS_LABELS[row.status], 11) + relativeAge(row.updatedAt).padStart(9) : ''
    return (
      <Box key={row.id} flexDirection="row">
        <Text backgroundColor={isSelected ? colors.selectionBg : undefined} bold={isSelected}>
          <Text color={colors.primary}>{isSelected ? '› ' : '  '}</Text>
          <Text color={glyphColor[row.status]}>{glyph(row.status)}</Text>
          <Text color={isSelected ? colors.text : row.status === 'inactive' ? colors.textDim : colors.text}>{' ' + title}</Text>
          <Text color={colors.textDim}>{meta}</Text>
        </Text>
      </Box>
    )
  }

  const details = selected && (
    <Box flexDirection="column" width={38}>
      <Text bold color={colors.text}>{'Task details'}</Text>
      <Text bold color={colors.primary}>{clip(selected.title, 38)}</Text>
      <Text><Text color={glyphColor[selected.status]}>{glyph(selected.status)}</Text><Text color={colors.textDim}>{' ' + STATUS_LABELS[selected.status]}</Text></Text>
      <Text> </Text>
      <Text color={colors.textDim}>{'Project'}</Text>
      <Text color={colors.text}>{clip(displayCwd(selected.cwd), 38)}</Text>
      <Text color={colors.text}>{clip(`Model: ${selected.model}`, 38)}</Text>
      <Text> </Text>
      <Text color={colors.textDim}>{'Prompt'}</Text>
      <Text color={colors.text}>{clip(selected.prompt.replace(/\s+/g, ' ') || 'No prompt available.', 76)}</Text>
      {selected.lastMessage && <>
        <Text> </Text>
        <Text color={colors.textDim}>{'Last message'}</Text>
        <Text color={colors.text}>{clip(selected.lastMessage.replace(/\s+/g, ' '), 38 * 4)}</Text>
      </>}
    </Box>
  )

  const footer = notice ?? (mode === 'delete' ? `Delete "${clip(selected?.title ?? '', 40)}"? y to confirm, any key to cancel`
    : mode === 'search' || mode === 'rename' ? `esc back  enter ${mode === 'rename' ? 'rename' : 'open'}`
    : '? help  esc back  ↑/↓ move  enter open  n new')

  return (
    <Box flexDirection="column" paddingX={2} paddingTop={1}>
      <Text>
        <Text bold color={colors.primary}>{`${STATUS_ICONS.agent} Command center`}</Text>
        <Text color={colors.textDim}>{`  Group: ${GROUPING_LABELS[GROUPINGS[grouping]!]}  g`}</Text>
      </Text>
      <Box flexDirection="row" justifyContent="space-between">
        <Text>
          {FILTERS.map((name, i) => (
            <Text key={name} bold={i === filter} color={i === filter ? colors.inputCursorText : colors.textDim} backgroundColor={i === filter ? colors.primary : undefined}>
              {` ${FILTER_LABELS[name]} ${counts[name]} `}
            </Text>
          ))}
        </Text>
        {bodyWidth >= 80 && <Text color={colors.textDim}>{'tab/shift+tab filter'}</Text>}
      </Box>
      <Text color={colors.rule}>{'─'.repeat(bodyWidth)}</Text>
      {(mode === 'search' || mode === 'rename') && (
        <Text><Text bold color={colors.info}>{mode === 'search' ? 'Search › ' : 'Rename › '}</Text><Text color={colors.text}>{mode === 'search' ? query : draft}</Text><Text backgroundColor={colors.inputCursorBg}> </Text></Text>
      )}
      {mode === 'help' ? (
        <Box flexDirection="column" marginTop={1}>
          <Text bold color={colors.text}>{'Task shortcuts'}</Text>
          {HELP.map(([keys, action]) => <Text key={keys}><Text color={colors.primary}>{keys.padEnd(16)}</Text><Text color={colors.textDim}>{action}</Text></Text>)}
        </Box>
      ) : (
        <Box flexDirection="row" gap={withDetails ? 1 : 0}>
          <Box flexDirection="column" width={listWidth}>
            {withMeta && <Text color={colors.textDim}>{'    ' + pad('Tasks', titleWidth) + pad('Status', 11) + 'Updated'.padStart(9)}</Text>}
            {saved === null ? <Text color={colors.textDim}>{'  Loading tasks…'}</Text>
              : shown.length === 0 ? <Text color={colors.textDim}>{rows.length ? '  No matching tasks' : '  No tasks yet'}</Text>
              : visibleLines.map((line, i) => line.kind === 'row' ? renderRow(line.row)
                : line.kind === 'group' ? <Text key={`g${start + i}`} color={colors.textDim}>{clip(line.label, listWidth)}</Text>
                : <Text key={`s${start + i}`}> </Text>)}
          </Box>
          {withDetails && <Text color={colors.rule}>{'│\n'.repeat(Math.max(12, visibleLines.length + (withMeta ? 1 : 0))).trimEnd()}</Text>}
          {withDetails && details}
        </Box>
      )}
      <Box marginTop={1}><Text color={notice ? colors.warning : colors.textDim}>{footer}</Text></Box>
    </Box>
  )
}
