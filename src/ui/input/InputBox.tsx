import { useState, useEffect, useRef } from 'react'
import useInput from '../../ink/hooks/use-input.js'
import type { Key } from '../../ink/events/input-event.js'
import { loadInputHistory } from '../../agent/inputHistory.js'
import type { AgentPhase } from '../App.js'
import { type InteractionMode } from '../interactionMode.js'
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
import { readClipboardImageSync, readClipboardSync } from '../../utils/platform.js'
import type { PromptImage } from '../../types/input.js'
import { prepareImagePrompt } from './imageAttachments.js'
import { insertDroppedPath, normalizeDroppedPath } from './fileDrop.js'
import type { KeybindingsSettings } from '../../settings/types.js'
import { resolveKeybindingAction, resolveKeybindings } from './keybindings.js'
import { useTheme, useThemeColors } from '../design-system/ThemeProvider.js'

// Aggregate limits for images attached to one prompt (base64-encoded size)
const MAX_IMAGE_COUNT = 20
const MAX_TOTAL_IMAGE_SIZE = 100 * 1024 * 1024

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

/**
 * The main prompt input. Owns the text/cursor state and routes every keypress:
 * bracketed paste (long text becomes a `[Text #n]` placeholder, file drops insert
 * the path, empty pastes and Ctrl+V attach clipboard images as `[Image #n]`),
 * slash-command and @file dropdowns, history, undo/redo, optional vim mode and
 * submit. While `isLoading`, submits go to `onQueue` instead (except workflow
 * control commands) and Esc/Ctrl+C abort. Placeholders are expanded on submit.
 */
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
  onSubmit: (text: string, images?: PromptImage[]) => void
  isLoading: boolean
  toolCallCount: number
  onAbort?: () => void
  onExit?: () => void
  onQueue?: (text: string, images?: PromptImage[]) => void
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
  const theme = useTheme()
  const colors = useThemeColors()
  const cols = process.stdout.columns ?? 80
  const [cursor, setCursor] = useState(() => Cursor.fromText('', cols))
  const [fullscreenHintVisible, setFullscreenHintVisible] = useState(showFullscreenHint)
  const [pastedTexts, setPastedTexts] = useState<string[]>([])
  const [pastedImages, setPastedImages] = useState<PromptImage[]>([])
  const [imageNotice, setImageNotice] = useState<string | null>(null)
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
    setImageNotice(null)
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
      setPastedImages([])
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

  const prepareSubmittedPrompt = (text: string) => prepareImagePrompt(expandPastedTexts(text), pastedImages)

  const insertImage = (image: PromptImage) => {
    if (pastedImages.length >= MAX_IMAGE_COUNT) {
      setImageNotice(`Image not attached: limit is ${MAX_IMAGE_COUNT} images per message.`)
      return
    }
    const currentSize = pastedImages.reduce((sum, img) => sum + img.data.length, 0)
    if (currentSize + image.data.length > MAX_TOTAL_IMAGE_SIZE) {
      const mb = (bytes: number) => Math.ceil(bytes / (1024 * 1024))
      setImageNotice(`Image not attached: images would exceed ${mb(MAX_TOTAL_IMAGE_SIZE)}MB (${mb(currentSize)}MB attached, this one ${mb(image.data.length)}MB).`)
      return
    }
    const idx = pastedImages.length
    setPastedImages((prev) => [...prev, image])
    updateCursor(cursor.insert(`[Image #${idx + 1}]`))
    setSelectedIdx(0)
    historyRef.current.reset()
  }

  const insertDroppedFile = (droppedPath: string) => {
    const inserted = insertDroppedPath(cursor.text, cursor.offset, droppedPath)
    updateCursor(Cursor.fromText(inserted.text, cols, inserted.offset))
    setSelectedIdx(0)
    historyRef.current.reset()
  }

  const matches = getMatches(cursor.text)
  const showDropdown = matches.length > 0
  const showFileDropdown = fileMatches.length > 0 && !showDropdown
  const ghost = getSuggestedReplyGhost(cursor.text, suggestedReply) ?? computeGhostText(cursor.text, cursor.offset)
  const resolvedKeybindings = resolveKeybindings(keybindings)

  const submitPrompt = (text: string, images: PromptImage[] = []) => {
    if (images.length > 0) onSubmit(text, images)
    else onSubmit(text)
  }

  const submitOrQueueWhileLoading = (value: string, images: PromptImage[] = []) => {
    const text = value.trim()
    if (!text) return
    if (/^\/workflows(?:\s|$)|^\/workflow\s+(?:pause|resume|stop)\b/.test(text)) submitPrompt(text, images)
    else if (images.length > 0) onQueue?.(text, images)
    else onQueue?.(text)
  }

  useInput((input: string, key: Key) => {
    // Bracketed paste from terminal (Ctrl+Shift+V or middle-click)
    if (key.isPasted) {
      const droppedPath = normalizeDroppedPath(input)
      if (droppedPath) insertDroppedFile(droppedPath)
      else if (input.length > 0) handlePaste(input)
      else {
        const image = readClipboardImageSync()
        if (image) insertImage(image)
      }
      return
    }
    const keyEvent = inkKeyToKeyEvent(key, input)
    const action = resolveKeybindingAction(keyEvent, resolvedKeybindings)

    if (action === 'cycleMode' || input === '\x1b[Z') {
      onModeChange?.()
      return
    }
    if (activityAvailable && cursor.text.length === 0 && !showDropdown && !showFileDropdown && (key.downArrow || key.leftArrow)) {
      onActivityOpen?.()
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
        const image = readClipboardImageSync()
        if (image) insertImage(image)
        else {
          const text = readClipboardSync()
          if (text) handlePaste(text)
        }
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

    // Tab only fills the input with the suggestion; Enter sends it, so it can be edited first.
    if (suggestedReply && cursor.text.length === 0 && action === 'acceptCompletion') {
      updateCursor(Cursor.fromText(suggestedReply, cols, suggestedReply.length))
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
      setPastedImages([])
      setSelectedIdx(0)
      historyRef.current.reset()
      setVimState(createVimState)
      return
    }

    if (isLoading && action === 'submit') {
      const submitted = prepareSubmittedPrompt(cursor.text)
      if (submitted.text.trim()) {
        submitOrQueueWhileLoading(submitted.text, submitted.images)
        updateCursor(Cursor.fromText('', cols))
        setPastedTexts([])
        setPastedImages([])
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
          const submitted = prepareSubmittedPrompt(chunk.cursor.text)
          if (isLoading) {
            if (submitted.text.trim()) submitOrQueueWhileLoading(submitted.text, submitted.images)
          } else {
            submitPrompt(submitted.text, submitted.images)
          }
          updateCursor(Cursor.fromText('', cols))
          setPastedTexts([])
          setPastedImages([])
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
          const submitted = prepareSubmittedPrompt(full)
          if (isLoading) {
            if (submitted.text.trim()) submitOrQueueWhileLoading(submitted.text, submitted.images)
          } else {
            submitPrompt(submitted.text, submitted.images)
          }
          updateCursor(Cursor.fromText('', cols))
          setPastedTexts([])
          setPastedImages([])
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
      const submitted = prepareSubmittedPrompt(cursor.text)
      if (isLoading) {
        if (submitted.text.trim()) submitOrQueueWhileLoading(submitted.text, submitted.images)
      } else {
        submitPrompt(submitted.text, submitted.images)
      }
      updateCursor(Cursor.fromText('', cols))
      setPastedTexts([])
      setPastedImages([])
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

  const dropdown = showDropdown
    ? <CommandDropdown
        matches={matches}
        selectedIdx={selectedIdx}
        columns={cols}
        descriptions={{ ...getCustomCommandDescriptions(), ...getWorkflowCommandDescriptions(), ...COMMAND_DESCRIPTIONS }}
      />
    : showFileDropdown
      ? <FileDropdown
          files={fileMatches}
          selectedIdx={fileSelectedIdx}
          columns={cols}
          query={getAtMention(cursor.text, cursor.offset)?.query ?? ''}
        />
      : null

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
          theme={theme}
        >
          <InputLine
            cursor={cursor}
            columns={cols - 4 /* rounded border + paddingX of InputChrome */}
            placeholder={placeholder}
            ghostText={ghost?.text}
            prefix={''}
            prefixColor={hasExclamation ? colors.bashBorder : colors.h2}
          />
          {ctrlCDouble.armed && (
            <Text color={colors.warning}>{'  Press Ctrl+C again to exit'}</Text>
          )}
          {escDouble.armed && (
            <Text color={colors.warning}>{'  Press Esc again to clear input'}</Text>
          )}
          {imageNotice && (
            <Text color={colors.warning}>{`  ${imageNotice}`}</Text>
          )}
        </InputChrome>

        {/* Fullscreen overlays the transcript; inline mode has no rows above the input to spare (an empty chat would cover the header), so the list goes in flow below it. */}
        {dropdown && (isFullscreenActive()
          ? <Box position="absolute" bottom="100%" width="100%" opaque>{dropdown}</Box>
          : dropdown)}
      </Box>
    </Box>
  )
}
