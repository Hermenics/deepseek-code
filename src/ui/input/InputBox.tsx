import { useState, useEffect, useRef } from 'react'
import useInput from '../../ink/hooks/use-input.js'
import type { Key } from '../../ink/events/input-event.js'
import { loadInputHistory } from '../../agent/inputHistory.js'
import type { AgentPhase } from '../App.js'
import { MODE_LABELS, MODE_COLORS, type InteractionMode } from '../interactionMode.js'
import { Cursor } from './cursor/index.js'
import { processTextInputKey, type KeyEvent } from './hooks/useTextInput.js'
import { processVimKey, processVimTextChunk, createVimState, type VimState } from './hooks/useVimMode.js'
import { InputBuffer } from './hooks/useInputBuffer.js'
import { useDoublePress } from './hooks/useDoublePress.js'
import { usePasteHandler } from './hooks/usePasteHandler.js'
import { InputHistory } from './hooks/useInputHistory.js'
import { getMatches } from './commandMatches.js'
import { computeGhostText, getSuggestedReplyGhost } from './ghost/index.js'
import { COMMAND_DESCRIPTIONS } from '../../commands.js'
import { getWorkflowCommandDescriptions } from '../../workflows/commands.js'
import { getCustomCommandDescriptions } from '../../commands/custom.js'
import { InputLine } from './render/InputLine.js'
import { CommandDropdown } from './render/CommandDropdown.js'
import { FileDropdown } from './render/FileDropdown.js'
import { InputChrome } from './render/InputChrome.js'
import Box from '../../ink/components/Box.js'
import Text from '../../ink/components/Text.js'
import { getAtMention, searchFiles } from './fileMatcher.js'
import { isFullscreenActive } from '../../utils/fullscreen.js'
import { readClipboardSync } from '../../utils/platform.js'
import type { KeybindingsSettings } from '../../settings/types.js'
import { resolveKeybindingAction, resolveKeybindings } from './keybindings.js'

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
  onExit,
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
  showFullscreenHint = false,
  keybindings,
  suggestedReply,
  onSuggestedReplyDismiss,
}: {
  onSubmit: (text: string) => void
  isLoading: boolean
  toolCallCount: number
  onAbort?: () => void
  onExit?: () => void
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
  /** Show the "switch it in /config" hint. Caller hides it once the conversation starts. */
  showFullscreenHint?: boolean
  /** Optional resolved settings; omitted values retain the built-in defaults. */
  keybindings?: KeybindingsSettings
  suggestedReply?: string
  onSuggestedReplyDismiss?: () => void
}) {
  const cols = process.stdout.columns ?? 80
  const [cursor, setCursor] = useState(() => Cursor.fromText('', cols))
  const [fullscreenHintVisible, setFullscreenHintVisible] = useState(showFullscreenHint)
  const [pastedTexts, setPastedTexts] = useState<string[]>([])
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [vimState, setVimState] = useState<VimState>(createVimState)
  const [fileMatches, setFileMatches] = useState<string[]>([])
  const [fileSelectedIdx, setFileSelectedIdx] = useState(0)

  const historyRef = useRef(new InputHistory())
  const bufferRef = useRef(new InputBuffer())
  const fileSearchRequestRef = useRef(0)

  useEffect(() => {
    if (!showFullscreenHint) setFullscreenHintVisible(false)
  }, [showFullscreenHint])

  const updateCursor = (next: Cursor) => {
    fileSearchRequestRef.current++
    setFileMatches([])
    setFileSelectedIdx(0)
    if (next.text.length > 0) setFullscreenHintVisible(false)
    if (next.text.length > 0) onSuggestedReplyDismiss?.()
    setCursor(next)
  }

  const ctrlCDouble = useDoublePress({
    timeout: 800,
    onDoublePress: () => {
      onExit?.()
      if (!onExit) process.exit(0)
    },
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

  // usePasteHandler owns the block-vs-inline rule; these two say what to do
  // with each kind. The threshold lives there — don't restate it here.
  const { handlePaste } = usePasteHandler({
    onPasteBlock: (text: string) => {
      // Stored out of band and given a [Text #n] placeholder — expanded on submit
      const idx = pastedTexts.length
      setPastedTexts((prev) => [...prev, text.replace(/\r\n/g, '\n')])
      updateCursor(cursor.insert(`[Text #${idx + 1}]`))
      setSelectedIdx(0)
      historyRef.current.reset()
    },
    onPasteInline: (text: string) => {
      const lines = text.replace(/\r\n/g, '\n').split('\n')
      updateCursor(cursor.insert(lines.length > 1 ? lines.join(' ') : text))
      setSelectedIdx(0)
      historyRef.current.reset()
    },
  })

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
  const ghost = getSuggestedReplyGhost(cursor.text, suggestedReply) ?? computeGhostText(cursor.text, cursor.offset)
  const resolvedKeybindings = resolveKeybindings(keybindings)

  const submitOrQueueWhileLoading = (value: string) => {
    const text = value.trim()
    if (!text) return
    if (/^\/workflows(?:\s|$)|^\/workflow\s+(?:pause|resume|stop)\b/.test(text)) onSubmit(text)
    else onQueue?.(text)
  }

  useInput((input: string, key: Key) => {
    // Bracketed paste from terminal (Ctrl+Shift+V or middle-click)
    if (key.isPasted && input.length > 0) {
      handlePaste(input)
      return
    }
    const keyEvent = inkKeyToKeyEvent(key, input)
    const action = resolveKeybindingAction(keyEvent, resolvedKeybindings)

    if (action === 'cycleMode' || input === '\x1b[Z') {
      onModeChange?.()
      return
    }
    if (input.startsWith('\x1b')) return
    if (input.length === 1 && input.charCodeAt(0) < 32 && !key.ctrl) return

    // Reset double-press states on any other key
    if (!(key.ctrl && input === 'c')) ctrlCDouble.reset()
    if (!key.escape) escDouble.reset()

    if (action === 'abort' && isLoading) {
      onAbort?.()
      return
    }
    if (key.ctrl && input === 'c') {
      if (isLoading) { onAbort?.(); return }
      ctrlCDouble.trigger()
      return
    }

    // Deixa teclas de scroll serem tratadas pelo <Box focused>
    if (key.pageUp || key.pageDown) {
      return
    }

    if (key.ctrl && input === 'v') {
      try {
        const text = readClipboardSync()
        if (text) handlePaste(text)
      } catch {}
      return
    }

    if (key.ctrl && input === 'z') {
      const entry = key.shift ? bufferRef.current.redo() : bufferRef.current.undo()
      if (entry) updateCursor(Cursor.fromText(entry.text, cols, entry.cursorOffset))
      return
    }

    if (action === 'cancel' || key.escape) {
      if (isLoading) {
        onAbort?.()
        return
      }
      if (!vimEnabled && cursor.text.length > 0) {
        escDouble.trigger()
        return
      }
    }

    // Argument placeholders are display-only, so they never get accepted by
    // Tab/right-arrow or inserted into the input buffer.

    if (showFileDropdown && (key.upArrow || key.downArrow)) {
      setFileSelectedIdx((i) =>
        key.upArrow
          ? (i - 1 + fileMatches.length) % fileMatches.length
          : (i + 1) % fileMatches.length,
      )
      return
    }

    if (suggestedReply && cursor.text.length === 0 && action === 'acceptCompletion') {
      onSubmit(suggestedReply)
      onSuggestedReplyDismiss?.()
      updateCursor(Cursor.fromText('', cols))
      setPastedTexts([])
      historyRef.current.reset()
      return
    }

    if (showFileDropdown && (action === 'acceptCompletion' || (key.return && !key.ctrl && !key.shift))) {
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

    if (showDropdown && (action === 'acceptCompletion' || (key.return && !key.ctrl && !key.shift))) {
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

    if (isLoading && action === 'submit') {
      const queued = expandPastedTexts(cursor.text).trim()
      if (queued) {
        submitOrQueueWhileLoading(queued)
        updateCursor(Cursor.fromText('', cols))
          setPastedTexts([])
      }
      return
    }

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

    const result = processTextInputKey(cursor, keyEvent, { multiline: true, keybindings })
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
      {fullscreenHintVisible && showFullscreenHint && isFullscreenActive() && (
        <Box justifyContent="flex-end">
          <Text dimColor>{"Don't like this screen? Change it in /config"}</Text>
        </Box>
      )}
      <Box flexDirection="column" position="relative">
        <InputChrome
          columns={cols}
          agentLabel={agentLabel}
          agentColor={agentColor}
          contextPct={contextPct}
          hasExclamation={hasExclamation}
        >
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
          <Box position="absolute" bottom="100%" width="100%">
            <CommandDropdown
              matches={matches}
              selectedIdx={selectedIdx}
              columns={cols}
              descriptions={{ ...getCustomCommandDescriptions(), ...getWorkflowCommandDescriptions(), ...COMMAND_DESCRIPTIONS }}
            />
          </Box>
        )}

        {showFileDropdown && (
          <Box position="absolute" bottom="100%" width="100%">
            <FileDropdown
              files={fileMatches}
              selectedIdx={fileSelectedIdx}
              columns={cols}
              query={getAtMention(cursor.text, cursor.offset)?.query ?? ''}
            />
          </Box>
        )}
      </Box>
    </Box>
  )
}
