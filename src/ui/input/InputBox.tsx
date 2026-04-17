import React, { useState, useEffect } from 'react'
import { Box, Text } from 'ink'
import { COMMAND_SUGGESTIONS } from '../../commands.js'
import { useClock } from '../clock.js'
import { loadInputHistory } from '../../agent/inputHistory.js'
import type { AgentPhase } from '../App.js'

const DESCRIPTIONS: Record<string, string> = {
  '/quit': 'Exit DeepSeek Code',
  '/q': 'Exit DeepSeek Code',
  '/clear': 'Clear chat history',
  '/help': 'Show available commands',
  '/agent': 'Load a custom agent',
  '/agents': 'List available agents',
  '/model deepseek-chat': 'Switch to DeepSeek-V3 (fast, general purpose)',
  '/model deepseek-reasoner': 'Switch to DeepSeek-R1 (chain-of-thought reasoning)',
  '/undo': 'Restore last file modified by agent',
  '/retry': 'Re-run last message',
  '/cost': 'Show estimated session cost',
  '/files': 'List files modified this session',
  '/checkpoint': 'Save current state',
  '/checkpoint list': 'List saved checkpoints',
}

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

const REFINING_MSGS = [
  // 'Engenheirizando seu prompt...',
  'Prompt-engineering your prompt...',
  // 'Destilando a essência do problema...',
  'Distilling the essence of the problem...',
  // 'Traduzindo humano para IA...',
  'Translating human to AI...',
  // 'Calibrando os neurônios artificiais...',
  'Calibrating artificial neurons...',
  // 'Aplicando prompt engineering de elite...',
  'Applying elite prompt engineering...',
  // 'Decompondo o problema em átomos...',
  'Atomizing the problem...',
  // 'Refinando a pergunta com bisturi...',
  'Scalpel-sharpening your question...',
  // 'Transformando caos em clareza...',
  'Untangling chaos into clarity...',
  // 'Pensando antes de pensar...',
  'Pre-thinking the thinking...',
  // 'Consultando o oráculo da engenharia...',
  'Consulting the engineering oracle...',
  // 'Destrinchando a intenção do usuário...',
  'Reverse-engineering your intent...',
  // 'Montando o prompt perfeito...',
  'Assembling the perfect prompt...',
]

const LOADING_MSGS = [
  // 'Consultando os deuses do código...',
  'Consulting the code gods...',
  // 'Fingindo que entendi o problema...',
  'Pretending to understand the problem...',
  // 'Procurando no Stack Overflow...',
  'Zigzagging through Stack Overflow...',
  // 'Compilando desculpas...',
  'Compiling excuses...',
  // 'Treinando neurônios artificiais...',
  'Training artificial neurons...',
  // 'Lendo a documentação (mentira)...',
  'Reading the docs (not really)...',
  // 'Calculando a resposta errada...',
  'Calculating the wrong answer...',
  // 'Bebendo café virtual...',
  'Sipping virtual coffee...',
  // 'Debugando o universo...',
  'Debugging the universe...',
  // 'Perguntando pro ChatGPT (brincadeira)...',
  'Definitely not asking ChatGPT...',
  // 'Inventando uma solução elegante...',
  'Inventing an elegant solution...',
  // 'Rezando pra não dar segfault...',
  'Praying for no segfault...',
  // 'Ignorando os warnings...',
  'Ignoring the warnings...',
  // 'Fazendo git blame em você...',
  'Running git blame on you...',
  // 'Simulando inteligência...',
  'Simulating intelligence...',
  // 'Escovando bits com escova de dente...',
  'Toothbrushing the bits...',
  // 'Convencendo o ponteiro a não apontar pro vazio...',
  'Convincing the pointer not to dereference null...',
  // 'Esperando o lixeiro do Garbage Collector...',
  'Waiting for the garbage collector...',
  // 'Afinando o pente do JSON...',
  'Fine-combing the JSON...',
  // 'Colocando aspas no mundo (stringfy)...',
  'Stringifying the world...',
  // 'Ensinando o loop a dar nó...',
  'Teaching the loop to loop...',
  // 'Polindo os parênteses...',
  'Polishing the parentheses...',
  // 'Desconfiando do tipo any...',
  'Side-eyeing the any type...',
  // 'Mandando o callback para a terapia...',
  'Sending the callback to therapy...',
  // 'Testando o commit sem mensagem...',
  'Committing without a message...',
  // 'Deployando no céu (cloud)...',
  'Deploying to the cloud (literally)...',
  // 'Removendo o café da variável...',
  'Removing coffee from the variable...',
  // 'Compilando a paciência...',
  'Compiling patience...',
  // 'Serializando o caos...',
  'Serializing the chaos...',
  // 'Parseando o sentido da vida...',
  'Parsing the meaning of life...',
  // 'Fugindo do merge conflict...',
  'Fleeing the merge conflict...',
  // 'Commitando sem permissão...',
  'Committing without permission...',
  // 'Rebaseando a realidade...',
  'Rebasing reality...',
  // 'Mergeando a consciência...',
  'Merging consciousness...',
  // 'Tentando dar console.log no vazio...',
  'console.logging the void...',
  // 'Confiando no que o mundo vê...',
  'Trusting what the world sees...',
  // 'Filosofando com o Google....',
  'Philosophizing with Google...',
]

function LoadingSpinner({ toolCallCount, phase }: { toolCallCount: number; phase: AgentPhase }) {
  const tick = useClock()
  const [msgIdx, setMsgIdx] = useState(() => Math.floor(Math.random() * LOADING_MSGS.length))
  const [refineIdx] = useState(() => Math.floor(Math.random() * REFINING_MSGS.length))

  useEffect(() => {
    setMsgIdx(Math.floor(Math.random() * LOADING_MSGS.length))
  }, [toolCallCount])

  const isRefining = phase === 'refining'
  const msg = isRefining ? REFINING_MSGS[refineIdx % REFINING_MSGS.length] : LOADING_MSGS[msgIdx]

  return (
    <Box gap={1} paddingLeft={1}>
      <Text color={isRefining ? 'magenta' : 'cyan'}>{SPINNER[tick % SPINNER.length]}</Text>
      <Text dimColor>{msg}</Text>
      <Text dimColor> ·  Ctrl+C to cancel</Text>
    </Box>
  )
}

function getMatches(value: string): string[] {
  if (!value.startsWith('/')) return []
  return COMMAND_SUGGESTIONS.filter((s) => s.startsWith(value) && s !== value)
}

interface KeyInfo {
  name?: string
  sequence: string
  ctrl: boolean
  meta: boolean
  shift: boolean
}

function parseKey(sequence: string): KeyInfo {
  const ctrl = sequence.charCodeAt(0) === 0x1b
  const meta = sequence.includes('\x1b')
  const shift = false

  if (sequence === '\x1b[A') return { name: 'up', sequence, ctrl, meta, shift }
  if (sequence === '\x1b[B') return { name: 'down', sequence, ctrl, meta, shift }
  if (sequence === '\x1b[C') return { name: 'right', sequence, ctrl, meta, shift }
  if (sequence === '\x1b[D') return { name: 'left', sequence, ctrl, meta, shift }
  if (sequence === '\x1b[H') return { name: 'home', sequence, ctrl, meta, shift }
  if (sequence === '\x1b[F') return { name: 'end', sequence, ctrl, meta, shift }
  if (sequence === '\x1b[3~') return { name: 'delete', sequence, ctrl, meta, shift }
  if (sequence === '\x7f') return { name: 'backspace', sequence, ctrl: false, meta: false, shift: false }
  if (sequence === '\r' || sequence === '\n') return { name: 'return', sequence, ctrl, meta, shift }
  if (sequence === '\x1b') return { name: 'escape', sequence, ctrl, meta, shift }
  if (sequence === '\t') return { name: 'tab', sequence, ctrl, meta, shift }

  return { name: undefined, sequence, ctrl, meta, shift }
}

export function InputBox({
  onSubmit,
  isLoading,
  toolCallCount,
  onAbort,
  phase = 'idle',
  contextPct = 0,
}: {
  onSubmit: (text: string) => void
  isLoading: boolean
  toolCallCount: number
  onAbort?: () => void
  phase?: AgentPhase
  contextPct?: number  // 0–100
}) {
  const [value, setValue] = useState('')
  const [cursorPos, setCursorPos] = useState(0)
  const [pastedBlock, setPastedBlock] = useState<string | null>(null)
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [ctrlCAt, setCtrlCAt] = useState<number | null>(null)

  // Input history state
  const [inputHistory, setInputHistory] = useState<string[]>([])
  const [historyIdx, setHistoryIdx] = useState<number>(-1)
  const [savedDraft, setSavedDraft] = useState('')

  // Load history on mount
  useEffect(() => {
    loadInputHistory().then(setInputHistory)
  }, [])

  // Clear the "press again to exit" hint after 2s
  useEffect(() => {
    if (ctrlCAt === null) return
    const t = setTimeout(() => setCtrlCAt(null), 2000)
    return () => clearTimeout(t)
  }, [ctrlCAt])

  const matches = getMatches(value)
  const showDropdown = matches.length > 0

  useEffect(() => {
    const stdin = process.stdin

    if (typeof stdin.setRawMode !== 'function') return

    const wasRaw = stdin.isRaw
    const wasPaused = stdin.isPaused()

    stdin.setRawMode(true)
    stdin.resume()

    const onData = (data: Buffer) => {
      const sequence = data.toString()

      // Ctrl+C handling
      if (sequence === '\x03') {
        if (isLoading) {
          // Abort the current agent request
          onAbort?.()
        } else {
          // Double-tap to exit
          const now = Date.now()
          if (ctrlCAt !== null && now - ctrlCAt < 2000) {
            process.exit(0)
          } else {
            setCtrlCAt(now)
          }
        }
        return
      }

      // Any other key clears the "press again" hint
      if (ctrlCAt !== null && sequence !== '\x03') {
        setCtrlCAt(null)
      }

      if (isLoading) return

      const key = parseKey(sequence)

      // ── Command autocomplete dropdown ──────────────────────────────────────
      if (showDropdown) {
        if (key.name === 'up') {
          setSelectedIdx((i) => (i - 1 + matches.length) % matches.length)
          return
        }
        if (key.name === 'down') {
          setSelectedIdx((i) => (i + 1) % matches.length)
          return
        }
        if (key.name === 'tab' || key.name === 'return') {
          const chosen = matches[selectedIdx]!
          if (key.name === 'return' && value === chosen) {
            onSubmit(value)
            setValue('')
            setCursorPos(0)
            setSelectedIdx(0)
            setHistoryIdx(-1)
            return
          }
          setValue(chosen)
          setCursorPos(chosen.length)
          setSelectedIdx(0)
          return
        }
        if (key.name === 'escape') {
          setValue('')
          setCursorPos(0)
          setSelectedIdx(0)
          return
        }
      } else {
        // ── Input history navigation (↑↓ when no dropdown) ──────────────────
        if (key.name === 'up') {
          if (inputHistory.length === 0) return
          const newIdx = historyIdx === -1
            ? inputHistory.length - 1
            : Math.max(0, historyIdx - 1)
          if (historyIdx === -1) setSavedDraft(value)
          setHistoryIdx(newIdx)
          const entry = inputHistory[newIdx] ?? ''
          setValue(entry)
          setCursorPos(entry.length)
          return
        }
        if (key.name === 'down') {
          if (historyIdx === -1) return
          const newIdx = historyIdx + 1
          if (newIdx >= inputHistory.length) {
            // Back to draft
            setHistoryIdx(-1)
            setValue(savedDraft)
            setCursorPos(savedDraft.length)
          } else {
            setHistoryIdx(newIdx)
            const entry = inputHistory[newIdx] ?? ''
            setValue(entry)
            setCursorPos(entry.length)
          }
          return
        }

        if (key.name === 'return') {
          const full = pastedBlock ? `${pastedBlock}\n${value}` : value
          onSubmit(full)
          setValue('')
          setCursorPos(0)
          setPastedBlock(null)
          setHistoryIdx(-1)
          setSavedDraft('')
          return
        }
        if (key.name === 'escape') {
          setValue('')
          setCursorPos(0)
          setPastedBlock(null)
          setHistoryIdx(-1)
          setSavedDraft('')
          return
        }
      }

      // ── Cursor movement ────────────────────────────────────────────────────
      if (key.name === 'left') { setCursorPos((pos) => Math.max(0, pos - 1)); return }
      if (key.name === 'right') { setCursorPos((pos) => Math.min(value.length, pos + 1)); return }
      if (key.name === 'home') { setCursorPos(0); return }
      if (key.name === 'end') { setCursorPos(value.length); return }

      // ── Deletion ───────────────────────────────────────────────────────────
      if (key.name === 'backspace') {
        if (cursorPos > 0) {
          setValue((v) => v.slice(0, cursorPos - 1) + v.slice(cursorPos))
          setCursorPos((pos) => pos - 1)
          setSelectedIdx(0)
          setHistoryIdx(-1)
        } else if (pastedBlock) {
          setPastedBlock(null)
        }
        return
      }
      if (key.name === 'delete') {
        if (cursorPos < value.length) {
          setValue((v) => v.slice(0, cursorPos) + v.slice(cursorPos + 1))
          setSelectedIdx(0)
          setHistoryIdx(-1)
        }
        return
      }

      // ── Regular input ──────────────────────────────────────────────────────
      if (!key.name && !key.ctrl && !key.meta && sequence.length === 1 && sequence >= ' ') {
        if (sequence === '\n' && value.includes('\n')) {
          const lines = value.split('\n')
          if (lines.length > 5) {
            setPastedBlock((pastedBlock ?? '') + value + '\n')
            setValue('')
            setCursorPos(0)
            setSelectedIdx(0)
            setHistoryIdx(-1)
            return
          }
        }
        setValue((v) => v.slice(0, cursorPos) + sequence + v.slice(cursorPos))
        setCursorPos((pos) => pos + 1)
        setSelectedIdx(0)
        setHistoryIdx(-1)
      }
    }

    stdin.on('data', onData)
    return () => {
      stdin.removeListener('data', onData)
      if (!wasRaw) stdin.setRawMode(false)
      if (wasPaused) stdin.pause()
    }
  }, [isLoading, onAbort, value, cursorPos, pastedBlock, showDropdown, selectedIdx, matches, onSubmit,
    inputHistory, historyIdx, savedDraft, ctrlCAt])

  const cols = process.stdout.columns ?? 80
  const isLong = value.length >= cols - 7 // account for " > " prefix (3 chars) + cursor + margin

  useEffect(() => {
    if (isLoading) return
    if (typeof process.stdout.write !== 'function') return
    process.stdout.write('\x1b[?25l')
    return () => { process.stdout.write('\x1b[?25h') }
  }, [isLoading])

  const renderTextWithCursor = () => {
    if (value === '') {
      return (
        <>
          <Text color="white">█</Text>
          {!pastedBlock && <Text dimColor>What do you want me to do now? ↵</Text>}
        </>
      )
    }

    if (isLong) {
      const before = value.slice(0, cursorPos)
      const at = value.slice(cursorPos, cursorPos + 1) || ' '
      const after = value.slice(cursorPos + 1)
      return <Text>{`${before}\x1b[7m${at}\x1b[27m${after}`}</Text>
    }

    const beforeCursor = value.slice(0, cursorPos)
    const atCursor = value.slice(cursorPos, cursorPos + 1)
    const afterCursor = value.slice(cursorPos + 1)

    return (
      <>
        <Text>{beforeCursor}</Text>
        <Text color="white" backgroundColor="white" inverse>{atCursor || ' '}</Text>
        <Text>{afterCursor}</Text>
      </>
    )
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      {isLoading ? (
        <LoadingSpinner toolCallCount={toolCallCount} phase={phase} />
      ) : ctrlCAt !== null ? (
        <Box paddingLeft={1}>
          <Text color="yellow">Press Ctrl+C again to exit.</Text>
        </Box>
      ) : (
        <Box>
          {contextPct > 0 && (
            <Text
              color={contextPct >= 90 ? 'red' : contextPct >= 70 ? 'yellow' : undefined}
              dimColor={contextPct < 50}
            >
              {contextPct}%{' '}
            </Text>
          )}
          <Text color="cyan">{'>'} </Text>
          {pastedBlock && (
            <Box marginRight={1} paddingX={1} borderStyle="round" borderColor="gray">
              <Text dimColor>{pastedBlock.split('\n').length} lines</Text>
            </Box>
          )}
          {renderTextWithCursor()}
        </Box>
      )}
      {!isLoading && ctrlCAt === null && showDropdown && (
        <Box flexDirection="column" marginTop={1} marginLeft={4}>
          {matches.map((cmd, i) => (
            <Box key={cmd} gap={2}>
              <Text bold color={i === selectedIdx ? 'cyan' : undefined}>{cmd}</Text>
              <Text dimColor={i !== selectedIdx} color={i === selectedIdx ? 'cyan' : undefined}>
                {DESCRIPTIONS[cmd] ?? ''}
              </Text>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  )
}
