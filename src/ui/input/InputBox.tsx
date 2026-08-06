import { useState, useEffect, useRef } from 'react'
import useInput from '../../ink/hooks/use-input.js'
import type { Key } from '../../ink/events/input-event.js'
import { execSync } from 'child_process'
import { loadInputHistory } from '../../agent/inputHistory.js'
import type { AgentPhase } from '../App.js'
import { MODE_LABELS, MODE_COLORS, type InteractionMode } from '../interactionMode.js'
import { Cursor } from './cursor/index.js'
import { processTextInputKey, type KeyEvent } from './hooks/useTextInput.js'
import { processVimKey, processVimTextChunk, createVimState, type VimState } from './hooks/useVimMode.js'
import { InputBuffer } from './hooks/useInputBuffer.js'
import { useDoublePress } from './hooks/useDoublePress.js'
import { InputHistory } from './hooks/useInputHistory.js'
import { getCommandSuggestions, getMatches } from './commandMatches.js'
import { computeGhostText } from './ghost/index.js'
import { COMMAND_DESCRIPTIONS } from '../../commands.js'
import { getWorkflowCommandDescriptions } from '../../workflows/commands.js'
import { InputLine } from './render/InputLine.js'
import { CommandDropdown } from './render/CommandDropdown.js'
import { FileDropdown } from './render/FileDropdown.js'
import { InputChrome } from './render/InputChrome.js'
import Box from '../../ink/components/Box.js'
import Text from '../../ink/components/Text.js'
import { getAtMention, searchFiles } from './fileMatcher.js'

// Convert Ink's Key (boolean flags) to KeyEvent (name-based) used by processTextInputKey/processVimKey
export function inkKeyToKeyEvent(key: Key, input: string): KeyEvent {
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
    raw:      !isSpecial && !key.ctrl && !key.meta && input.length > 0 ? input : undefined,
    sequence: input,
  }
}

export { LoadingSpinner } from './render/LoadingSpinner.js'
export { getMatches } from './commandMatches.js'

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
  workingDirectory,
  fuzzyFileSearch = true,
  activityAvailable = false,
  onActivityOpen,
  isActive = true,
  placeholderOverride,
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
  placeholderOverride?: string
  interactionMode?: InteractionMode
  onModeChange?: () => void
  sessionId?: string
  vimEnabled?: boolean
  workingDirectory: string
  fuzzyFileSearch?: boolean
  activityAvailable?: boolean
  onActivityOpen?: () => void
  isActive?: boolean
}) {
  const cols = process.stdout.columns ?? 80
  const [cursor, setCursor] = useState(() => Cursor.fromText('', cols))
  const [pastedTexts, setPastedTexts] = useState<string[]>([])
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [vimState, setVimState] = useState<VimState>(createVimState)
  const [fileMatches, setFileMatches] = useState<string[]>([])
  const [fileSelectedIdx, setFileSelectedIdx] = useState(0)

  const historyRef = useRef(new InputHistory())
  const bufferRef = useRef(new InputBuffer())
  const fileSearchRequestRef = useRef(0)

  const updateCursor = (next: Cursor) => {
    fileSearchRequestRef.current++
    setFileMatches([])
    setFileSelectedIdx(0)
    setCursor(next)
  }

  const ctrlCDouble = useDoublePress({
    timeout: 800,
    onDoublePress: () => process.exit(0),
  })

  const escDouble = useDoublePress({
    timeout: 800,
    onDoublePress: () => {
      updateCursor(Cursor.fromText('', cols))
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

  useEffect(() => {
    const requestId = ++fileSearchRequestRef.current
    const mention = getAtMention(cursor.text, cursor.offset)
    if (!mention) {
      setFileMatches([])
      setFileSelectedIdx(0)
      return
    }

    const timer = setTimeout(() => {
      void searchFiles(mention.query, workingDirectory, 8, fuzzyFileSearch).then((results) => {
        if (requestId !== fileSearchRequestRef.current) return
        setFileMatches(results)
        setFileSelectedIdx(0)
      })
    }, 100)
    return () => clearTimeout(timer)
  }, [cursor.text, cursor.offset, fuzzyFileSearch, workingDirectory])

  const applyInlinePaste = (text: string) => {
    const normalized = text.replace(/\r\n/g, '\n')
    // Long pastes get a [Text #n] placeholder — real content sent on submit
    if (normalized.length > 60) {
      let idx = 0
      setPastedTexts((prev) => { idx = prev.length; return [...prev, normalized] })
      // Use queueMicrotask to read idx after setPastedTexts updater ran
      updateCursor(cursor.insert(`[Text #${idx + 1}]`))
      setSelectedIdx(0)
      historyRef.current.reset()
      return
    }
    const lines = normalized.split('\n')
    const inserted = lines.length > 1 ? lines.join(' ') : text
    updateCursor(cursor.insert(inserted))
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
  const showFileDropdown = fileMatches.length > 0 && !showDropdown
  const ghost = computeGhostText(cursor.text, cursor.offset, getCommandSuggestions(), historyRef.current.entries)

  const submitOrQueueWhileLoading = (value: string) => {
    const text = value.trim()
    if (!text) return
    if (/^\/workflows(?:\s|$)|^\/workflow\s+(?:pause|resume|stop)\b/.test(text)) onSubmit(text)
    else onQueue?.(text)
  }

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
      if (entry) updateCursor(Cursor.fromText(entry.text, cols, entry.cursorOffset))
      return
    }

    if (key.escape) {
      if (isLoading) {
        onAbort?.()
        return
      }
      if (!vimEnabled && cursor.text.length > 0) {
        escDouble.trigger()
        return
      }
    }

    if (!showDropdown && ghost && ghost.insertPosition === cursor.offset) {
      if (key.tab) {
        updateCursor(Cursor.fromText(ghost.fullCommand, cols, ghost.fullCommand.length))
        setSelectedIdx(0)
        historyRef.current.reset()
        return
      }
      if (key.rightArrow && cursor.isAtEnd()) {
        updateCursor(Cursor.fromText(ghost.fullCommand, cols, ghost.fullCommand.length))
        setSelectedIdx(0)
        historyRef.current.reset()
        return
      }
    }

    if (showFileDropdown && (key.upArrow || key.downArrow)) {
      setFileSelectedIdx((i) =>
        key.upArrow
          ? (i - 1 + fileMatches.length) % fileMatches.length
          : (i + 1) % fileMatches.length,
      )
      return
    }

    if (showFileDropdown && (key.tab || key.return)) {
      const chosen = fileMatches[fileSelectedIdx]
      if (chosen) {
        const mention = getAtMention(cursor.text, cursor.offset)
        if (mention) {
          const before = cursor.text.slice(0, mention.atStart)
          const after = cursor.text.slice(mention.atEnd)
          const newText = before + '@' + chosen + ' ' + after
          const newOffset = mention.atStart + chosen.length + 2 // +2 for @ and space
          updateCursor(Cursor.fromText(newText, cols, newOffset))
        }
      }
      return
    }

    if (showDropdown && (key.upArrow || key.downArrow)) {
      setSelectedIdx((i) => key.upArrow ? (i - 1 + matches.length) % matches.length : (i + 1) % matches.length)
      return
    }

    if (showDropdown && (key.tab || key.return)) {
      const chosen = matches[selectedIdx]!
      onSubmit(chosen)
      updateCursor(Cursor.fromText('', cols))
      setPastedTexts([])
      setSelectedIdx(0)
      historyRef.current.reset()
      setVimState(createVimState)
      return
    }

    if (activityAvailable && key.downArrow && cursor.text.length === 0 && !showDropdown && !showFileDropdown) {
      onActivityOpen?.()
      return
    }

    if (isLoading && key.return) {
      const queued = expandPastedTexts(cursor.text).trim()
      if (queued) {
        submitOrQueueWhileLoading(queued)
        updateCursor(Cursor.fromText('', cols))
          setPastedTexts([])
      }
      return
    }

    const keyEvent = inkKeyToKeyEvent(key, input)

    if (vimEnabled) {
      if (input.length > 1 && !key.ctrl && !key.meta) {
        const chunk = processVimTextChunk(cursor, input, vimState)
        updateCursor(chunk.cursor)
        setVimState(chunk.state)
        setSelectedIdx(0)
        historyRef.current.reset()
        if (chunk.action === 'submit') {
          const expanded = expandPastedTexts(chunk.cursor.text)
          if (isLoading) {
            const queued = expanded.trim()
            if (queued) submitOrQueueWhileLoading(queued)
          } else {
            onSubmit(expanded)
          }
          updateCursor(Cursor.fromText('', cols))
          setPastedTexts([])
          setVimState(createVimState)
        } else if (chunk.action) {
          const entry = chunk.action === 'historyUp' ? historyRef.current.up(chunk.cursor.text) : historyRef.current.down()
          if (entry !== undefined) updateCursor(Cursor.fromText(entry, cols, entry.length))
        }
        return
      }

      const vim = processVimKey(cursor, keyEvent, vimState)
      if (vim.nextState) setVimState(vim.nextState)
      if (vim.type === 'modeChange') {
        updateCursor(vim.cursor)
        return
      }
      if (vim.type === 'cursor') {
        updateCursor(vim.cursor)
        return
      }
      if (vim.type === 'action') {
        if (vim.action === 'submit') {
          const full = cursor.text
          const expanded = expandPastedTexts(full)
          if (isLoading) {
            const queued = expanded.trim()
            if (queued) submitOrQueueWhileLoading(queued)
          } else {
            onSubmit(expanded)
          }
          updateCursor(Cursor.fromText('', cols))
              setPastedTexts([])
          historyRef.current.reset()
          setVimState(createVimState)
          return
        }
        const entry = vim.action === 'historyUp' ? historyRef.current.up(cursor.text) : historyRef.current.down()
        if (entry !== undefined) updateCursor(Cursor.fromText(entry, cols, entry.length))
        return
      }
      if (vim.type === 'noop' && vimState.mode === 'normal') return
    }

    const result = processTextInputKey(cursor, keyEvent, { multiline: true })
    if (result.type === 'cursor') {
      updateCursor(result.cursor)
      setSelectedIdx(0)
      historyRef.current.reset()
      return
    }

    if (result.action === 'submit') {
      const expanded = expandPastedTexts(cursor.text)
      if (isLoading) {
        const queued = expanded.trim()
        if (queued) submitOrQueueWhileLoading(queued)
      } else {
        onSubmit(expanded)
      }
      updateCursor(Cursor.fromText('', cols))
      setPastedTexts([])
      setSelectedIdx(0)
      historyRef.current.reset()
      return
    }

    if (result.action === 'historyUp' || result.action === 'historyDown') {
      const entry = result.action === 'historyUp' ? historyRef.current.up(cursor.text) : historyRef.current.down()
      if (entry !== undefined) updateCursor(Cursor.fromText(entry, cols, entry.length))
    }
  }, { isActive })

  const hasExclamation = cursor.text.trimStart().startsWith('!')
  const placeholder = placeholderOverride ?? (isLoading
    ? 'Queue a message...'
    : contextPct >= 90
      ? 'Context almost full. Try /compact'
      : 'What do you want me to do? ↵')

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
          descriptions={{ ...getWorkflowCommandDescriptions(), ...COMMAND_DESCRIPTIONS }}
        />
      )}

      {showFileDropdown && (
        <FileDropdown
          files={fileMatches}
          selectedIdx={fileSelectedIdx}
          columns={cols}
          query={getAtMention(cursor.text, cursor.offset)?.query ?? ''}
        />
      )}
    </Box>
  )
}
