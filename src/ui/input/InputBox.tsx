import { useState, useEffect, useRef } from 'react'
import { useKeyboard } from '@opentui/react'
import type { KeyEvent } from '@opentui/core'
import { useClock } from '../clock.js'
import { loadInputHistory } from '../../agent/inputHistory.js'
import type { AgentPhase } from '../App.js'
import { MODE_LABELS, MODE_COLORS, type InteractionMode } from '../interactionMode.js'
import { getMatches } from './commandMatches.js'

const DESCRIPTIONS: Record<string, string> = {
  '/quit': 'Exit DeepSeek Code',
  '/q': 'Exit DeepSeek Code',
  '/clear': 'Clear chat history',
  '/compact': 'Summarize history to save context',
  '/help': 'Show available commands',
  '/agent': 'Load a custom agent',
  '/agents': 'List available agents',
  '/model deepseek-v4-flash': 'Switch to DeepSeek V4 Flash',
  '/model deepseek-v4-pro': 'Switch to DeepSeek V4 Pro',
  '/model deepseek-reasoner': 'Switch to DeepSeek R1',
  '/models': 'Switch model interactively',
  '/language': 'Change preferred language',
  '/theme': 'Change color theme',
  '/undo': 'Restore last file modified by agent',
  '/retry': 'Re-run last message',
  '/cost': 'Show estimated session cost',
  '/files': 'List files modified this session',
  '/tools': 'List all available tools',
  '/system': 'Show active system prompt',
  '/sessions': 'List recent sessions',
  '/checkpoint': 'Save current state',
  '/checkpoint list': 'List saved checkpoints',
  '/plan': 'Plan implementation of a task',
  '/review': 'Review code in the project',
  '/msg': 'Add a note without interrupting the agent',
  '/vim': 'Toggle vim keybindings (normal/insert mode)',
  '/stats': 'Show session statistics',
}

const SPINNER = ['✻', '✼', '✽', '✾', '✿', '❀', '✿', '✾', '✽', '✼']

const REFINING_MSGS = [
  'Prompt-engineering your prompt...',
  'Distilling the essence of the problem...',
  'Translating human to AI...',
  'Calibrating artificial neurons...',
  'Applying elite prompt engineering...',
  'Atomizing the problem...',
  'Scalpel-sharpening your question...',
  'Untangling chaos into clarity...',
  'Pre-thinking the thinking...',
  'Consulting the engineering oracle...',
  'Reverse-engineering your intent...',
  'Assembling the perfect prompt...',
]

const LOADING_MSGS = [
  'Consulting the code gods...',
  'Pretending to understand the problem...',
  'Zigzagging through Stack Overflow...',
  'Compiling excuses...',
  'Training artificial neurons...',
  'Reading the docs (not really)...',
  'Calculating the wrong answer...',
  'Sipping virtual coffee...',
  'Debugging the universe...',
  'Definitely not asking ChatGPT...',
  'Inventing an elegant solution...',
  'Praying for no segfault...',
  'Ignoring the warnings...',
  'Running git blame on you...',
  'Simulating intelligence...',
  'Asking the rubber duck...',
  'Reticulating splines...',
  'Centering the div...',
  'Questioning life choices...',
  'Hoping the tests pass...',
]

export function LoadingSpinner({ toolCallCount, phase }: { toolCallCount: number; phase: AgentPhase }) {
  const tick = useClock()
  const [msgIdx, setMsgIdx] = useState(() => Math.floor(Math.random() * LOADING_MSGS.length))
  const [refineIdx] = useState(() => Math.floor(Math.random() * REFINING_MSGS.length))

  useEffect(() => {
    setMsgIdx(Math.floor(Math.random() * LOADING_MSGS.length))
  }, [toolCallCount])

  const isRefining = phase === 'refining'
  const msg = isRefining ? REFINING_MSGS[refineIdx % REFINING_MSGS.length] : LOADING_MSGS[msgIdx]

  return (
    <box flexDirection="row" gap={1} paddingLeft={1}>
      <text fg={isRefining ? 'magenta' : 'cyan'}>{SPINNER[tick % SPINNER.length]}</text>
      <text fg="#888888">{msg}</text>
      <text fg="#888888">{' ·  Ctrl+C to cancel'}</text>
    </box>
  )
}

export { getMatches } from './commandMatches.js'

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
  const [value, setValue] = useState('')
  const [cursorPos, setCursorPos] = useState(0)
  const [pastedBlock, setPastedBlock] = useState<string | null>(null)
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [ctrlCAt, setCtrlCAt] = useState<number | null>(null)
  const [inputHistory, setInputHistory] = useState<string[]>([])
  const [historyIdx, setHistoryIdx] = useState<number>(-1)
  const [savedDraft, setSavedDraft] = useState('')
  // Vim mode: 'insert' = normal typing, 'normal' = vim navigation
  const [vimMode, setVimMode] = useState<'insert' | 'normal'>('insert')

  useEffect(() => {
    loadInputHistory().then(setInputHistory)
  }, [])

  useEffect(() => {
    if (ctrlCAt === null) return
    const t = setTimeout(() => setCtrlCAt(null), 2000)
    return () => clearTimeout(t)
  }, [ctrlCAt])

  const matches = getMatches(value)
  const showDropdown = matches.length > 0

  const stateRef = useRef({
    isLoading, onAbort, onSubmit, onQueue, onModeChange,
    value, cursorPos, pastedBlock,
    showDropdown, matches, selectedIdx,
    inputHistory, historyIdx, savedDraft, ctrlCAt,
    vimEnabled, vimMode,
  })
  useEffect(() => {
    stateRef.current = {
      isLoading, onAbort, onSubmit, onQueue, onModeChange,
      value, cursorPos, pastedBlock,
      showDropdown, matches, selectedIdx,
      inputHistory, historyIdx, savedDraft, ctrlCAt,
      vimEnabled, vimMode,
    }
  })

  useKeyboard((key: KeyEvent) => {
    const s = stateRef.current

    // Filter out mouse scroll events — they arrive as name:'up'/'down' with
    // raw containing ANSI mouse escape sequences (\x1b[< for SGR, \x1b[M for X10)
    if (key.raw && key.raw.length > 3 && key.raw.charCodeAt(0) === 0x1b && key.raw[1] === '[' && (key.raw[2] === '<' || key.raw[2] === 'M')) {
      return
    }

    // Ctrl+C handling
    if (key.ctrl && key.name === 'c') {
      if (s.isLoading) {
        s.onAbort?.()
      } else {
        const now = Date.now()
        if (s.ctrlCAt !== null && now - s.ctrlCAt < 2000) {
          process.exit(0)
        } else {
          setCtrlCAt(now)
        }
      }
      return
    }

    if (s.ctrlCAt !== null) {
      setCtrlCAt(null)
    }

    // Shift+Tab: toggle interaction mode
    if (key.shift && key.name === 'tab') {
      s.onModeChange?.()
      return
    }

    // When loading, allow typing but Enter queues the message
    if (s.isLoading) {
      if (key.name === 'return') {
        const trimmed = s.value.trim()
        if (trimmed) {
          s.onQueue?.(trimmed)
          setValue('')
          setCursorPos(0)
          setPastedBlock(null)
        }
        return
      }
      // Allow cursor movement and typing while loading
      if (key.name === 'left') { setCursorPos((pos) => Math.max(0, pos - 1)); return }
      if (key.name === 'right') { setCursorPos((pos) => Math.min(s.value.length, pos + 1)); return }
      if (key.name === 'home') { setCursorPos(0); return }
      if (key.name === 'end') { setCursorPos(s.value.length); return }
      if (key.name === 'backspace') {
        if (s.cursorPos > 0) {
          setValue((v) => v.slice(0, s.cursorPos - 1) + v.slice(s.cursorPos))
          setCursorPos((pos) => pos - 1)
        } else if (s.pastedBlock) {
          setPastedBlock(null)
        }
        return
      }
      if (key.name === 'delete') {
        if (s.cursorPos < s.value.length) {
          setValue((v) => v.slice(0, s.cursorPos) + v.slice(s.cursorPos + 1))
        }
        return
      }
      if (key.raw && key.raw.length === 1 && !key.ctrl && !key.meta) {
        setValue((v) => v.slice(0, s.cursorPos) + key.raw + v.slice(s.cursorPos))
        setCursorPos((pos) => pos + key.raw!.length)
      }
      return
    }

    // ── Vim normal mode keybindings ────────────────────────────────────────────
    if (s.vimEnabled && s.vimMode === 'normal') {
      // Enter insert mode
      if (key.name === 'i') { setVimMode('insert'); return }
      if (key.name === 'a') {
        setCursorPos((pos) => Math.min(s.value.length, pos + 1))
        setVimMode('insert')
        return
      }
      if (key.name === 'I') { setCursorPos(0); setVimMode('insert'); return }
      if (key.name === 'A') { setCursorPos(s.value.length); setVimMode('insert'); return }
      // Submit in normal mode
      if (key.name === 'return') {
        const full = s.pastedBlock ? `${s.pastedBlock}\n${s.value}` : s.value
        s.onSubmit(full)
        setValue('')
        setCursorPos(0)
        setPastedBlock(null)
        setHistoryIdx(-1)
        setSavedDraft('')
        setVimMode('insert')
        return
      }
      // Navigation
      if (key.name === 'h' || key.name === 'left') { setCursorPos((pos) => Math.max(0, pos - 1)); return }
      if (key.name === 'l' || key.name === 'right') { setCursorPos((pos) => Math.min(s.value.length, pos + 1)); return }
      if (key.name === '0' || key.name === 'home') { setCursorPos(0); return }
      if (key.name === '$' || key.name === 'end') { setCursorPos(s.value.length); return }
      // Word forward (w)
      if (key.name === 'w') {
        const rest = s.value.slice(s.cursorPos)
        const match = rest.match(/\S+\s*/)
        setCursorPos((pos) => pos + (match ? match[0].length : rest.length))
        return
      }
      // Word backward (b)
      if (key.name === 'b') {
        const before = s.value.slice(0, s.cursorPos)
        const match = before.match(/\S+\s*$/)
        setCursorPos((pos) => pos - (match ? match[0].length : pos))
        return
      }
      // Delete char under cursor (x)
      if (key.name === 'x') {
        if (s.cursorPos < s.value.length) {
          setValue((v) => v.slice(0, s.cursorPos) + v.slice(s.cursorPos + 1))
        }
        return
      }
      // Delete to end of line (D)
      if (key.name === 'D') {
        setValue((v) => v.slice(0, s.cursorPos))
        return
      }
      // Delete whole line (dd via ctrl+d shortcut)
      if (key.ctrl && key.name === 'd') {
        setValue('')
        setCursorPos(0)
        return
      }
      // History navigation in normal mode
      if (key.name === 'k' || key.name === 'up') {
        if (s.inputHistory.length === 0) return
        const newIdx = s.historyIdx === -1
          ? s.inputHistory.length - 1
          : Math.max(0, s.historyIdx - 1)
        if (s.historyIdx === -1) setSavedDraft(s.value)
        setHistoryIdx(newIdx)
        const entry = s.inputHistory[newIdx] ?? ''
        setValue(entry)
        setCursorPos(entry.length)
        return
      }
      if (key.name === 'j' || key.name === 'down') {
        if (s.historyIdx === -1) return
        const newIdx = s.historyIdx + 1
        if (newIdx >= s.inputHistory.length) {
          setHistoryIdx(-1)
          setValue(s.savedDraft)
          setCursorPos(s.savedDraft.length)
        } else {
          setHistoryIdx(newIdx)
          const entry = s.inputHistory[newIdx] ?? ''
          setValue(entry)
          setCursorPos(entry.length)
        }
        return
      }
      return // swallow unhandled keys in normal mode
    }

    // ── Escape: enter vim normal mode (if vim enabled) or clear input ──────────
    if (key.name === 'escape') {
      if (s.vimEnabled) {
        setVimMode('normal')
        // Clamp cursor: in normal mode cursor can't be past last char
        setCursorPos((pos) => Math.max(0, Math.min(pos, s.value.length - 1)))
        return
      }
      setValue('')
      setCursorPos(0)
      setPastedBlock(null)
      setHistoryIdx(-1)
      setSavedDraft('')
      return
    }

    // Command autocomplete dropdown
    if (s.showDropdown) {
      if (key.name === 'up') {
        setSelectedIdx((i) => (i - 1 + s.matches.length) % s.matches.length)
        return
      }
      if (key.name === 'down') {
        setSelectedIdx((i) => (i + 1) % s.matches.length)
        return
      }
      if (key.name === 'tab' || key.name === 'return') {
        const chosen = s.matches[s.selectedIdx]!
        s.onSubmit(chosen)
        setValue('')
        setCursorPos(0)
        setSelectedIdx(0)
        setHistoryIdx(-1)
        setSavedDraft('')
        setVimMode('insert')
        return
      }
    } else {
      // Input history navigation
      if (key.name === 'up') {
        if (s.inputHistory.length === 0) return
        const newIdx = s.historyIdx === -1
          ? s.inputHistory.length - 1
          : Math.max(0, s.historyIdx - 1)
        if (s.historyIdx === -1) setSavedDraft(s.value)
        setHistoryIdx(newIdx)
        const entry = s.inputHistory[newIdx] ?? ''
        setValue(entry)
        setCursorPos(entry.length)
        return
      }
      if (key.name === 'down') {
        if (s.historyIdx === -1) return
        const newIdx = s.historyIdx + 1
        if (newIdx >= s.inputHistory.length) {
          setHistoryIdx(-1)
          setValue(s.savedDraft)
          setCursorPos(s.savedDraft.length)
        } else {
          setHistoryIdx(newIdx)
          const entry = s.inputHistory[newIdx] ?? ''
          setValue(entry)
          setCursorPos(entry.length)
        }
        return
      }

      if (key.name === 'return') {
        const full = s.pastedBlock ? `${s.pastedBlock}\n${s.value}` : s.value
        s.onSubmit(full)
        setValue('')
        setCursorPos(0)
        setPastedBlock(null)
        setHistoryIdx(-1)
        setSavedDraft('')
        return
      }
    }

    // Cursor movement
    if (key.name === 'left') { setCursorPos((pos) => Math.max(0, pos - 1)); return }
    if (key.name === 'right') { setCursorPos((pos) => Math.min(s.value.length, pos + 1)); return }
    if (key.name === 'home') { setCursorPos(0); return }
    if (key.name === 'end') { setCursorPos(s.value.length); return }

    // Deletion
    if (key.name === 'backspace') {
      if (s.cursorPos > 0) {
        setValue((v) => v.slice(0, s.cursorPos - 1) + v.slice(s.cursorPos))
        setCursorPos((pos) => pos - 1)
        setSelectedIdx(0)
        setHistoryIdx(-1)
      } else if (s.pastedBlock) {
        setPastedBlock(null)
      }
      return
    }
    if (key.name === 'delete') {
      if (s.cursorPos < s.value.length) {
        setValue((v) => v.slice(0, s.cursorPos) + v.slice(s.cursorPos + 1))
        setSelectedIdx(0)
        setHistoryIdx(-1)
      }
      return
    }

    // Regular character input
    if (key.raw && key.raw.length === 1 && !key.ctrl && !key.meta) {
      setValue((v) => v.slice(0, s.cursorPos) + key.raw + v.slice(s.cursorPos))
      setCursorPos((pos) => pos + key.raw!.length)
      setSelectedIdx(0)
      setHistoryIdx(-1)
    }
  })

  const cols = process.stdout.columns ?? 80

  const renderInputLine = () => {
    if (value === '') {
      return (
        <>
          <text fg="white" bg="white">{' '}</text>
          {!pastedBlock && <text fg="#888888">{'What do you want me to do? ↵'}</text>}
        </>
      )
    }
    const maxVisible = Math.max(20, cols - 10)
    if (value.length <= maxVisible) {
      const beforeCursor = value.slice(0, cursorPos)
      const atCursor = value.slice(cursorPos, cursorPos + 1) || ' '
      const afterCursor = value.slice(cursorPos + 1)
      return (
        <>
          <text>{beforeCursor}</text>
          <text fg="black" bg="white">{atCursor}</text>
          <text>{afterCursor}</text>
        </>
      )
    }
    // Sliding window for long text
    const half = Math.floor((maxVisible - 2) / 2)
    let start = Math.max(0, cursorPos - half)
    let end = Math.min(value.length, start + maxVisible - 2)
    if (end === value.length) start = Math.max(0, end - maxVisible + 2)
    if (start === 0) end = Math.min(value.length, maxVisible - 2)
    const prefix = start > 0 ? '…' : ''
    const suffix = end < value.length ? '…' : ''
    const visible = value.slice(start, end)
    const localCursor = cursorPos - start
    const beforeCursor = visible.slice(0, localCursor)
    const atCursor = visible.slice(localCursor, localCursor + 1) || ' '
    const afterCursor = visible.slice(localCursor + 1)
    return (
      <>
        <text fg="#888888">{prefix}</text>
        <text>{beforeCursor}</text>
        <text fg="black" bg="white">{atCursor}</text>
        <text>{afterCursor}</text>
        <text fg="#888888">{suffix}</text>
      </>
    )
  }

  return (
    <box flexDirection="column">
      {/* Top separator */}
      {(() => {
        const modeLabel = `[${MODE_LABELS[interactionMode]}]`
        const vimLabel = vimEnabled ? (vimMode === 'normal' ? ' [N]' : ' [I]') : ''
        const label = ` ${agentLabel} `
        const suffix = modeLabel + vimLabel + label + '────'
        const leftDashes = Math.max(0, cols - 8 - suffix.length)
        const dashes = '─'.repeat(leftDashes)
        return (
          <box flexDirection="row">
            <text fg="#888888">{dashes}</text>
            <text fg={MODE_COLORS[interactionMode]}>{modeLabel}</text>
            {vimEnabled && <text fg={vimMode === 'normal' ? 'yellow' : '#888888'}>{vimLabel}</text>}
            <text fg="#888888">{label + '────'}</text>
          </box>
        )
      })()}

      {/* Input area */}
      {ctrlCAt !== null ? (
        <box flexDirection="column" paddingLeft={1}>
          <text fg="yellow">Press Ctrl+C again to exit.</text>
          {sessionId && <text fg="#888888">{'  deepseek --resume ' + sessionId}</text>}
        </box>
      ) : (
        <box flexDirection="row">
          {contextPct > 0 && (() => {
            const color = contextPct >= 90 ? 'red' : contextPct >= 70 ? 'yellow' : 'cyan'
            return <text fg={color}>{contextPct + '% '}</text>
          })()}
          <text fg={value.trimStart().startsWith('!') ? 'magenta' : 'cyan'}>{value.trimStart().startsWith('!') ? '!' : '❯'}</text>
          <text>{' '}</text>
          {pastedBlock && (
            <box border borderStyle="rounded" borderColor="#888888" paddingLeft={1} paddingRight={1} marginRight={1}>
              <text fg="#888888">{pastedBlock.split('\n').length + ' lines'}</text>
            </box>
          )}
          {renderInputLine()}
        </box>
      )}

      {/* Bottom separator */}
      <text fg="#888888">{'─'.repeat(cols - 8)}</text>

      {/* Command dropdown */}
      {!isLoading && ctrlCAt === null && showDropdown && (() => {
        const MAX_VISIBLE = 6
        const total = matches.length
        const CMD_WIDTH = 22
        const descMaxLen = Math.max(10, cols - CMD_WIDTH - 4)

        const half = Math.floor(MAX_VISIBLE / 2)
        let start = Math.max(0, selectedIdx - half)
        const end = Math.min(total, start + MAX_VISIBLE)
        if (end - start < MAX_VISIBLE) start = Math.max(0, end - MAX_VISIBLE)
        const visible = matches.slice(start, end)

        return (
          <box flexDirection="column">
            {visible.map((cmd, vi) => {
              const i = start + vi
              const isSelected = i === selectedIdx
              const desc = DESCRIPTIONS[cmd] ?? ''
              const truncDesc = desc.length > descMaxLen ? desc.slice(0, descMaxLen - 1) + '…' : desc
              return (
                <box key={cmd} flexDirection="row">
                  <text fg="#888888">{'│ '}</text>
                  <text fg={isSelected ? 'cyan' : undefined}>{cmd.padEnd(CMD_WIDTH)}</text>
                  <text fg={isSelected ? 'cyan' : '#888888'}>{truncDesc}</text>
                </box>
              )
            })}
          </box>
        )
      })()}
    </box>
  )
}
