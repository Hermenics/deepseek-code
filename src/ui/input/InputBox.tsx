import React, { useState, useEffect, useRef } from 'react'
import { Box, Text } from 'ink'
import { COMMAND_SUGGESTIONS } from '../../commands.js'

const DESCRIPTIONS: Record<string, string> = {
  '/quit': 'Exit DeepSeek Code',
  '/q': 'Exit DeepSeek Code',
  '/clear': 'Clear chat history',
  '/help': 'Show available commands',
  '/agent': 'Load a custom agent',
  '/agents': 'List available agents',
  '/model deepseek-chat': 'Switch to DeepSeek-V3 (fast, general purpose)',
  '/model deepseek-reasoner': 'Switch to DeepSeek-R1 (chain-of-thought reasoning)',
}

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

const LOADING_MSGS = [
  'Consultando os deuses do código...',
  'Fingindo que entendi o problema...',
  'Procurando no Stack Overflow...',
  'Compilando desculpas...',
  'Treinando neurônios artificiais...',
  'Lendo a documentação (mentira)...',
  'Calculando a resposta errada...',
  'Bebendo café virtual...',
  'Debugando o universo...',
  'Perguntando pro ChatGPT (brincadeira)...',
  'Inventando uma solução elegante...',
  'Rezando pra não dar segfault...',
  'Ignorando os warnings...',
  'Fazendo git blame em você...',
  'Simulando inteligência...',
  'Escovando bits com escova de dente...',
  'Convencendo o ponteiro a não apontar pro vazio...',
  'Esperando o lixeiro do Garbage Collector...',
  'Afinando o pente do JSON...',
  'Colocando aspas no mundo (stringfy)...',
  'Ensinando o loop a dar nó...',
  'Polindo os parênteses...',
  'Desconfiando do tipo any...',
  'Mandando o callback para a terapia...',
  'Testando o commit sem mensagem...',
  'Deployando no céu (cloud)...',
  'Removendo o café da variável...',
  'Compilando a paciência...',
  'Serializando o caos...',
  'Parseando o sentido da vida...',
  'Fugindo do merge conflict...',
  'Commitando sem permissão...',
  'Rebaseando a realidade...',
  'Mergeando a consciência...',
  'Tentando dar console.log no vazio...'
]

function LoadingSpinner({ toolCallCount }: { toolCallCount: number }) {
  const [frame, setFrame] = useState(0)
  const [msgIdx, setMsgIdx] = useState(() => Math.floor(Math.random() * LOADING_MSGS.length))

  useEffect(() => {
    setMsgIdx(Math.floor(Math.random() * LOADING_MSGS.length))
  }, [toolCallCount])

  useEffect(() => {
    const t = setInterval(() => setFrame((f) => (f + 1) % SPINNER.length), 80)
    return () => clearInterval(t)
  }, [])

  return (
    <Box gap={1}>
      <Text color="cyan">{SPINNER[frame]}</Text>
      <Text dimColor>{LOADING_MSGS[msgIdx]}</Text>
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
  const shift = false // simplified
  
  // Check for special keys
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

export function InputBox({ onSubmit, isLoading, toolCallCount }: { onSubmit: (text: string) => void; isLoading: boolean; toolCallCount: number }) {
  const [value, setValue] = useState('')
  const [cursorPos, setCursorPos] = useState(0)
  const [pastedBlock, setPastedBlock] = useState<string | null>(null)
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [isRawModeEnabled, setIsRawModeEnabled] = useState(false)

  const matches = getMatches(value)
  const showDropdown = matches.length > 0

  // Handle key input in raw mode
  useEffect(() => {
    if (isLoading) return
    
    const stdin = process.stdin
    
    // Save original state
    const wasRaw = stdin.isRaw
    const wasPaused = stdin.isPaused()
    
    // Enable raw mode
    stdin.setRawMode(true)
    stdin.resume()
    setIsRawModeEnabled(true)
    
    const onData = (data: Buffer) => {
      const sequence = data.toString()
      
      // Handle Ctrl+C
      if (sequence === '\x03') {
        process.exit(0)
      }
      
      const key = parseKey(sequence)
      
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
        if (key.name === 'return') {
          const full = pastedBlock ? `${pastedBlock}\n${value}` : value
          onSubmit(full)
          setValue('')
          setCursorPos(0)
          setPastedBlock(null)
          return
        }
        if (key.name === 'escape') { 
          setValue('')
          setCursorPos(0)
          setPastedBlock(null)
          return
        }
      }

      // Handle cursor movement
      if (key.name === 'left') {
        setCursorPos((pos) => Math.max(0, pos - 1))
        return
      }
      if (key.name === 'right') {
        setCursorPos((pos) => Math.min(value.length, pos + 1))
        return
      }
      if (key.name === 'home') {
        setCursorPos(0)
        return
      }
      if (key.name === 'end') {
        setCursorPos(value.length)
        return
      }

      // Handle deletion
      if (key.name === 'backspace') {
        if (cursorPos > 0) {
          setValue((v) => v.slice(0, cursorPos - 1) + v.slice(cursorPos))
          setCursorPos((pos) => pos - 1)
          setSelectedIdx(0)
        } else if (pastedBlock) {
          setPastedBlock(null)
        }
        return
      }
      
      if (key.name === 'delete') {
        if (cursorPos < value.length) {
          setValue((v) => v.slice(0, cursorPos) + v.slice(cursorPos + 1))
          setSelectedIdx(0)
        }
        return
      }

      // Handle regular input
      if (!key.name && !key.ctrl && !key.meta && sequence.length === 1 && sequence >= ' ') {
        // Detect paste: multiple lines added at once
        if (sequence === '\n' && value.includes('\n')) {
          const lines = value.split('\n')
          if (lines.length > 5) {
            setPastedBlock((pastedBlock ?? '') + value + '\n')
            setValue('')
            setCursorPos(0)
            setSelectedIdx(0)
            return
          }
        }
        
        // Insert character at cursor position
        setValue((v) => v.slice(0, cursorPos) + sequence + v.slice(cursorPos))
        setCursorPos((pos) => pos + 1)
        setSelectedIdx(0)
      }
    }
    
    stdin.on('data', onData)
    
    return () => {
      stdin.removeListener('data', onData)
      
      // Restore original state
      if (!wasRaw) {
        stdin.setRawMode(false)
      }
      if (wasPaused) {
        stdin.pause()
      }
      setIsRawModeEnabled(false)
    }
  }, [isLoading, value, cursorPos, pastedBlock, showDropdown, selectedIdx, matches, onSubmit])

  const cols = process.stdout.columns ?? 80
  const isLong = value.length >= cols - 4

  // Always hide real terminal cursor — we render our own inline
  useEffect(() => {
    if (isLoading) return
    process.stdout.write('\x1b[?25l') // hide cursor
    return () => { process.stdout.write('\x1b[?25h') } // always restore on unmount
  }, [isLoading])

  const renderTextWithCursor = () => {
    if (value === '') {
      return (
        <>
          <Text color="white">█</Text>
          <Text dimColor>ask a question or describe a task ↵</Text>
        </>
      )
    }

    if (isLong) {
      // Use ANSI escape codes inline so word wrap works naturally
      const before = value.slice(0, cursorPos)
      const at = value.slice(cursorPos, cursorPos + 1) || ' '
      const after = value.slice(cursorPos + 1)
      // \x1b[7m = inverse on, \x1b[27m = inverse off
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
    <Box flexDirection="column">
      {isLoading ? (
        <Box gap={1}>
          <LoadingSpinner toolCallCount={toolCallCount} />
          <Text dimColor> · type to queue a message</Text>
        </Box>
      ) : (
        <Box>
          {pastedBlock && (
            <Box marginRight={1} paddingX={1} borderStyle="round" borderColor="gray">
              <Text dimColor>{pastedBlock.split('\n').length} lines</Text>
            </Box>
          )}
          {renderTextWithCursor()}
        </Box>
      )}
      {showDropdown && (
        <Box flexDirection="column" marginTop={1}>
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
