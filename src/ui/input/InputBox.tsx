import { useState, useEffect, useRef } from 'react'
import { useKeyboard, usePaste } from '@opentui/react'
import type { KeyEvent } from '@opentui/core'
import { execSync } from 'child_process'
import { loadInputHistory } from '../../agent/inputHistory.js'
import type { AgentPhase } from '../App.js'
import { MODE_LABELS, MODE_COLORS, type InteractionMode } from '../interactionMode.js'
import { Cursor } from './cursor/index.js'
import { processTextInputKey } from './hooks/useTextInput.js'
import { processVimKey } from './hooks/useVimMode.js'
import { InputBuffer } from './hooks/useInputBuffer.js'
import { InputHistory } from './hooks/useInputHistory.js'
import { getMatches } from './commandMatches.js'
import { InputLine } from './render/InputLine.js'
import { CommandDropdown } from './render/CommandDropdown.js'
import { InputChrome } from './render/InputChrome.js'

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
}

export function InputBox({
  onSubmit,
  isLoading,
  toolCallCount,
  onAbort,
  onQueue,
  phase = 'idle',
  contextPct = 0,
  agentLabel = 'deepseek',
  interactionMode = 'chat',
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
  interactionMode?: InteractionMode
  onModeChange?: () => void
  sessionId?: string
  vimEnabled?: boolean
}) {
  const cols = process.stdout.columns ?? 80
  const [cursor, setCursor] = useState(() => Cursor.fromText('', cols))
  const [pastedBlock, setPastedBlock] = useState<string | null>(null)
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [vimMode, setVimMode] = useState<'insert' | 'normal'>('insert')

  const historyRef = useRef(new InputHistory())
  const bufferRef = useRef(new InputBuffer())

  useEffect(() => {
    loadInputHistory().then((entries) => historyRef.current.setHistory(entries))
  }, [sessionId])

  useEffect(() => {
    bufferRef.current.push(cursor.text, cursor.offset)
  }, [cursor])

  const applyInlinePaste = (text: string) => {
    const lines = text.replace(/\r\n/g, '\n').split('\n')
    if (lines.length > 3 || text.length > 200) {
      setPastedBlock(text)
      setCursor(Cursor.fromText('', cols))
      return
    }
    const inserted = lines.length > 1 ? lines.join(' ') : text
    setCursor((c) => c.insert(inserted))
    setSelectedIdx(0)
    historyRef.current.reset()
  }

  usePaste((event) => {
    const text = new TextDecoder().decode(event.bytes)
    if (text) applyInlinePaste(text)
  })

  const matches = getMatches(cursor.text)
  const showDropdown = matches.length > 0

  useKeyboard((key: KeyEvent) => {
    if ((key.name === 'up' || key.name === 'down') && key.raw && key.raw.length > 3) return
    if (key.raw === '\x1b[Z' || (key.shift && key.name === 'tab')) {
      onModeChange?.()
      return
    }
    if (!key.name && key.raw) {
      if (key.raw.startsWith('\x1b')) return
      if (key.raw.length === 1 && key.raw.charCodeAt(0) < 32) return
    }

    if (key.ctrl && key.name === 'c') {
      if (isLoading) onAbort?.()
      return
    }

    // Deixa teclas de scroll serem tratadas pelo <scrollbox focused>
    if (key.name === 'pageup' || key.name === 'pagedown') {
      return
    }

    if (key.ctrl && key.name === 'v') {
      try {
        const text = execSync('xclip -selection clipboard -o 2>/dev/null || xsel --clipboard --output 2>/dev/null || wl-paste 2>/dev/null', { encoding: 'utf-8', timeout: 2000 })
        if (text) applyInlinePaste(text)
      } catch {}
      return
    }

    if (key.sequence && key.sequence.includes('\x1b')) return

    if (key.ctrl && key.name === 'z') {
      const entry = key.shift ? bufferRef.current.redo() : bufferRef.current.undo()
      if (entry) setCursor(Cursor.fromText(entry.text, cols, entry.cursorOffset))
      return
    }

    if (showDropdown && (key.name === 'up' || key.name === 'down')) {
      setSelectedIdx((i) => key.name === 'up' ? (i - 1 + matches.length) % matches.length : (i + 1) % matches.length)
      return
    }

    if (showDropdown && (key.name === 'tab' || key.name === 'return' || key.name === 'enter')) {
      const chosen = matches[selectedIdx]!
      onSubmit(chosen)
      setCursor(Cursor.fromText('', cols))
      setPastedBlock(null)
      setSelectedIdx(0)
      historyRef.current.reset()
      setVimMode('insert')
      return
    }

    if (isLoading && (key.name === 'return' || key.name === 'enter')) {
      const queued = cursor.text.trim()
      if (queued) {
        onQueue?.(queued)
        setCursor(Cursor.fromText('', cols))
        setPastedBlock(null)
      }
      return
    }

    if (vimEnabled) {
      const vim = processVimKey(cursor, key, { mode: vimMode })
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
          const full = pastedBlock ? `${pastedBlock}\n${cursor.text}` : cursor.text
          if (isLoading) {
            const queued = full.trim()
            if (queued) onQueue?.(queued)
          } else {
            onSubmit(full)
          }
          setCursor(Cursor.fromText('', cols))
          setPastedBlock(null)
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

    const result = processTextInputKey(cursor, key, { multiline: true })
    if (result.type === 'cursor') {
      setCursor(result.cursor)
      setSelectedIdx(0)
      historyRef.current.reset()
      return
    }

    if (result.action === 'submit') {
      const full = pastedBlock ? `${pastedBlock}\n${cursor.text}` : cursor.text
      if (isLoading) {
        const queued = full.trim()
        if (queued) onQueue?.(queued)
      } else {
        onSubmit(full)
      }
      setCursor(Cursor.fromText('', cols))
      setPastedBlock(null)
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

  return (
    <box flexDirection="column">
      <InputChrome
        columns={cols}
        agentLabel={agentLabel}
        interactionMode={interactionMode}
        modeLabel={`[${MODE_LABELS[interactionMode]}]`}
        modeColor={MODE_COLORS[interactionMode]}
        vimEnabled={vimEnabled}
        vimMode={vimMode}
        contextPct={contextPct}
        hasExclamation={hasExclamation}
      >
        {pastedBlock && (
          <box border borderStyle="rounded" borderColor="#888888" paddingLeft={1} paddingRight={1} marginRight={1}>
            <text fg="#888888">{'[Pasted text | ' + pastedBlock.split('\n').length + ' lines]'}</text>
          </box>
        )}
        <InputLine cursor={cursor} columns={cols} placeholder={pastedBlock ? '' : 'What do you want me to do? ↵'} />
      </InputChrome>

      {showDropdown && (
        <CommandDropdown
          matches={matches}
          selectedIdx={selectedIdx}
          columns={cols}
          descriptions={DESCRIPTIONS}
        />
      )}
    </box>
  )
}
