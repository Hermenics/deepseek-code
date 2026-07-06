import { useState, useEffect, useRef } from 'react'
import useInput from '../../ink/hooks/use-input.js'
import type { Key } from '../../ink/events/input-event.js'
import { execSync } from 'child_process'
import { loadInputHistory } from '../../agent/inputHistory.js'
import type { AgentPhase } from '../App.js'
import { MODE_LABELS, MODE_COLORS, type InteractionMode } from '../interactionMode.js'
import { Cursor } from './cursor/index.js'
import { processTextInputKey, type KeyEvent } from './hooks/useTextInput.js'
import { processVimKey } from './hooks/useVimMode.js'
import { InputBuffer } from './hooks/useInputBuffer.js'
import { useDoublePress } from './hooks/useDoublePress.js'
import { InputHistory } from './hooks/useInputHistory.js'
import { getMatches } from './commandMatches.js'
import { computeGhostText } from './ghost/index.js'
import { COMMAND_SUGGESTIONS } from '../../commands.js'
import { InputLine } from './render/InputLine.js'
import { CommandDropdown } from './render/CommandDropdown.js'
import { InputChrome } from './render/InputChrome.js'
import Box from '../../ink/components/Box.js'
import Text from '../../ink/components/Text.js'

// Convert Ink's Key (boolean flags) to KeyEvent (name-based) used by processTextInputKey/processVimKey
function inkKeyToKeyEvent(key: Key, input: string): KeyEvent {
  let name: string | undefined
  let isSpecial = false

  if (key.upArrow)    { name = 'up';        isSpecial = true }
  else if (key.downArrow)  { name = 'down';      isSpecial = true }
  else if (key.leftArrow)  { name = 'left';      isSpecial = true }
  else if (key.rightArrow) { name = 'right';     isSpecial = true }
  else if (key.return)     { name = 'return';    isSpecial = true }
  else if (key.escape)     { name = 'escape';    isSpecial = true }
  else if (key.backspace)  { name = 'backspace'; isSpecial = true }
  else if (key.delete)     { name = 'delete';    isSpecial = true }
  else if (key.tab)        { name = 'tab';       isSpecial = true }
  else if (key.home)       { name = 'home';      isSpecial = true }
  else if (key.end)        { name = 'end';       isSpecial = true }
  else if (key.pageUp)     { name = 'pageup';    isSpecial = true }
  else if (key.pageDown)   { name = 'pagedown';  isSpecial = true }
  else if (key.ctrl && input.length === 1) {
    name = input.toLowerCase()
    isSpecial = true
  }

  return {
    name,
    ctrl:     key.ctrl,
    meta:     key.meta,
    shift:    key.shift,
    option:   key.meta,
    // raw = printable character to insert (only when not a special key and not a control combo)
    raw:      !isSpecial && !key.ctrl && !key.meta && input.length === 1 ? input : undefined,
    sequence: input,
  }
}

export { LoadingSpinner } from './render/LoadingSpinner.js'
export { getMatches } from './commandMatches.js'

const DESCRIPTIONS: Record<string, string> = {
  '/quit': 'Exit DeepSeek Code', '/q': 'Exit DeepSeek Code', '/clear': 'Clear chat history',
  '/compact': 'Summarize history to save context', '/help': 'Show available commands', '/agent': 'Load a custom agent',
  '/agents': 'List available agents', '/model deepseek-v4-flash': 'Switch to DeepSeek V4 Flash',
  '/model deepseek-v4-pro': 'Switch to DeepSeek V4 Pro', '/model deepseek-reasoner': 'Switch to DeepSeek R1',
  '/models': 'Switch model interactively', '/language': 'Change preferred language', '/theme': 'Change color theme',
  '/undo': 'Restore last file modified by agent', '/retry': 'Re-run last message', '/cost': 'Show estimated session cost',
  '/files': 'List files modified this session', '/tools': 'List all available tools', '/system': 'Show active system prompt',
  '/sessions': 'List recent sessions', '/checkpoint': 'Save current state', '/checkpoint list': 'List saved checkpoints',
  '/plan': 'Plan implementation of a task', '/review': 'Review code in the project', '/msg': 'Add a note without interrupting the agent',
  '/vim': 'Toggle vim keybindings (normal/insert mode)', '/stats': 'Show session statistics',
  '/effort': 'Set reasoning effort level', '/effort low': 'Quick responses',
  '/effort high': 'Comprehensive thinking', '/effort max': 'Maximum reasoning depth',
  '/enchant-prompt': 'Toggle prompt enchantment (AI refinement)',
  '/enchant': 'Toggle prompt enchantment (AI refinement)',
}

export function InputBox({
  onSubmit,
  isLoading,
  toolCallCount: _toolCallCount,
  onAbort,
  onQueue,
  phase: _phase = 'idle',
  contextPct = 0,
  agentLabel = 'deepseek',
  agentColor,
  interactionMode = 'build',
  onModeChange,
  sessionId,
  vimEnabled = false,
}: {
  onSubmit: (text: string) => void
  isLoading: boolean
  toolCallCount: number
  onAbort?: () => void
  onQueue?: (text: string) => void
  phase?: AgentPhase
  contextPct?: number
  agentLabel?: string
  agentColor?: string
  interactionMode?: InteractionMode
  onModeChange?: () => void
  sessionId?: string
  vimEnabled?: boolean
}) {
  const cols = process.stdout.columns ?? 80
  const [cursor, setCursor] = useState(() => Cursor.fromText('', cols))
  const [pastedTexts, setPastedTexts] = useState<string[]>([])
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [vimMode, setVimMode] = useState<'insert' | 'normal'>('insert')

  const historyRef = useRef(new InputHistory())
  const bufferRef = useRef(new InputBuffer())

  const ctrlCDouble = useDoublePress({
    timeout: 800,
    onDoublePress: () => process.exit(0),
  })

  const escDouble = useDoublePress({
    timeout: 800,
    onDoublePress: () => {
      setCursor(Cursor.fromText('', cols))
      setPastedTexts([])
      setSelectedIdx(0)
      historyRef.current.reset()
    },
  })

  useEffect(() => {
    loadInputHistory().then((entries) => historyRef.current.setHistory(entries))
  }, [sessionId])

  useEffect(() => {
    bufferRef.current.push(cursor.text, cursor.offset)
  }, [cursor])

  const applyInlinePaste = (text: string) => {
    const normalized = text.replace(/\r\n/g, '\n')
    // Long pastes get a [Text #n] placeholder — real content sent on submit
    if (normalized.length > 60) {
      let idx = 0
      setPastedTexts((prev) => { idx = prev.length; return [...prev, normalized] })
      // Use queueMicrotask to read idx after setPastedTexts updater ran
      setCursor((c) => c.insert(`[Text #${idx + 1}]`))
      setSelectedIdx(0)
      historyRef.current.reset()
      return
    }
    const lines = normalized.split('\n')
    const inserted = lines.length > 1 ? lines.join(' ') : text
    setCursor((c) => c.insert(inserted))
    setSelectedIdx(0)
    historyRef.current.reset()
  }

  // Expand [Text #n] placeholders back to real pasted content
  const expandPastedTexts = (text: string): string => {
    if (pastedTexts.length === 0) return text
    return text.replace(/\[Text #(\d+)\]/g, (_match, n) => {
      const idx = parseInt(n, 10) - 1
      return pastedTexts[idx] ?? _match
    })
  }

  const matches = getMatches(cursor.text)
  const showDropdown = matches.length > 0
  const ghost = computeGhostText(cursor.text, cursor.offset, COMMAND_SUGGESTIONS, historyRef.current.entries)

  useInput((input: string, key: Key) => {
    // Bracketed paste from terminal (Ctrl+Shift+V or middle-click)
    if (key.isPasted && input.length > 0) {
      applyInlinePaste(input)
      return
    }
    if (input === '\x1b[Z' || (key.shift && key.tab)) {
      onModeChange?.()
      return
    }
    if (input.startsWith('\x1b')) return
    if (input.length === 1 && input.charCodeAt(0) < 32 && !key.ctrl) return

    // Reset double-press states on any other key
    if (!(key.ctrl && input === 'c')) ctrlCDouble.reset()
    if (!key.escape) escDouble.reset()

    if (key.ctrl && input === 'c') {
      if (isLoading) {
        onAbort?.()
        return
      }
      ctrlCDouble.trigger()
      return
    }

    // Deixa teclas de scroll serem tratadas pelo <Box focused>
    if (key.pageUp || key.pageDown) {
      return
    }

    if (key.ctrl && input === 'v') {
      try {
        const text = execSync('xclip -selection clipboard -o 2>/dev/null || xsel --clipboard --output 2>/dev/null || wl-paste 2>/dev/null', { encoding: 'utf-8', timeout: 2000 })
        if (text) applyInlinePaste(text)
      } catch {}
      return
    }

    if (key.ctrl && input === 'z') {
      const entry = key.shift ? bufferRef.current.redo() : bufferRef.current.undo()
      if (entry) setCursor(Cursor.fromText(entry.text, cols, entry.cursorOffset))
      return
    }

    if (key.escape && !vimEnabled && cursor.text.length > 0) {
      escDouble.trigger()
      return
    }

    if (!showDropdown && ghost && ghost.insertPosition === cursor.offset) {
      if (key.tab) {
        setCursor(Cursor.fromText(ghost.fullCommand, cols, ghost.fullCommand.length))
        setSelectedIdx(0)
        historyRef.current.reset()
        return
      }
      if (key.rightArrow && cursor.isAtEnd()) {
        setCursor(Cursor.fromText(ghost.fullCommand, cols, ghost.fullCommand.length))
        setSelectedIdx(0)
        historyRef.current.reset()
        return
      }
    }

    if (showDropdown && (key.upArrow || key.downArrow)) {
      setSelectedIdx((i) => key.upArrow ? (i - 1 + matches.length) % matches.length : (i + 1) % matches.length)
      return
    }

    if (showDropdown && (key.tab || key.return)) {
      const chosen = matches[selectedIdx]!
      onSubmit(chosen)
      setCursor(Cursor.fromText('', cols))
      setPastedTexts([])
      setSelectedIdx(0)
      historyRef.current.reset()
      setVimMode('insert')
      return
    }

    if (isLoading && key.return) {
      const queued = expandPastedTexts(cursor.text).trim()
      if (queued) {
        onQueue?.(queued)
        setCursor(Cursor.fromText('', cols))
          setPastedTexts([])
      }
      return
    }

    const keyEvent = inkKeyToKeyEvent(key, input)

    if (vimEnabled) {
      const vim = processVimKey(cursor, keyEvent, { mode: vimMode })
      if (vim.type === 'modeChange') {
        setVimMode(vim.mode)
        setCursor(vim.cursor)
        return
      }
      if (vim.type === 'cursor') {
        setCursor(vim.cursor)
        return
      }
      if (vim.type === 'action') {
        if (vim.action === 'submit') {
          const full = cursor.text
          const expanded = expandPastedTexts(full)
          if (isLoading) {
            const queued = expanded.trim()
            if (queued) onQueue?.(queued)
          } else {
            onSubmit(expanded)
          }
          setCursor(Cursor.fromText('', cols))
              setPastedTexts([])
          historyRef.current.reset()
          setVimMode('insert')
          return
        }
        const entry = vim.action === 'historyUp' ? historyRef.current.up(cursor.text) : historyRef.current.down()
        if (entry !== undefined) setCursor(Cursor.fromText(entry, cols, entry.length))
        return
      }
      if (vim.type === 'noop' && vimMode === 'normal') return
    }

    const result = processTextInputKey(cursor, keyEvent, { multiline: true })
    if (result.type === 'cursor') {
      setCursor(result.cursor)
      setSelectedIdx(0)
      historyRef.current.reset()
      return
    }

    if (result.action === 'submit') {
      const expanded = expandPastedTexts(cursor.text)
      if (isLoading) {
        const queued = expanded.trim()
        if (queued) onQueue?.(queued)
      } else {
        onSubmit(expanded)
      }
      setCursor(Cursor.fromText('', cols))
      setPastedTexts([])
      setSelectedIdx(0)
      historyRef.current.reset()
      return
    }

    if (result.action === 'historyUp' || result.action === 'historyDown') {
      const entry = result.action === 'historyUp' ? historyRef.current.up(cursor.text) : historyRef.current.down()
      if (entry !== undefined) setCursor(Cursor.fromText(entry, cols, entry.length))
    }
  })

  const hasExclamation = cursor.text.trimStart().startsWith('!')
  const placeholder = isLoading
    ? 'Queue a message...'
    : contextPct >= 90
      ? 'Context almost full. Try /compact'
      : 'What do you want me to do? ↵'

  return (
    <Box flexDirection="column">
      <InputChrome
        columns={cols}
        agentLabel={agentLabel}
        agentColor={agentColor}
        contextPct={contextPct}
        hasExclamation={hasExclamation}
      >
        {pastedTexts.length > 0 && (
          <Box border borderStyle="rounded" borderColor="#888888" paddingLeft={1} paddingRight={1} marginRight={1}>
            <Text color="#888888">{`[${pastedTexts.length} pasted]`}</Text>
          </Box>
        )}
        <InputLine
          cursor={cursor}
          columns={cols}
          placeholder={placeholder}
          ghostText={ghost?.text}
          prefix={''}
          prefixColor={hasExclamation ? 'magenta' : 'cyan'}
        />
        {ctrlCDouble.armed && (
          <Text color="yellow">{'  Press Ctrl+C again to exit'}</Text>
        )}
        {escDouble.armed && (
          <Text color="yellow">{'  Press Esc again to clear input'}</Text>
        )}
      </InputChrome>

      {showDropdown && (
        <CommandDropdown
          matches={matches}
          selectedIdx={selectedIdx}
          columns={cols}
          descriptions={DESCRIPTIONS}
        />
      )}
    </Box>
  )
}
