import React, { useState, useEffect } from 'react'
import { Box, Text, useInput } from 'ink'
import { COMMAND_SUGGESTIONS } from '../commands.js'

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

function LoadingSpinner() {
  const [frame, setFrame] = useState(0)
  const [msgIdx] = useState(() => Math.floor(Math.random() * LOADING_MSGS.length))

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

export function InputBox({ onSubmit, isLoading }: { onSubmit: (text: string) => void; isLoading: boolean }) {
  const [value, setValue] = useState('')
  const [selectedIdx, setSelectedIdx] = useState(0)

  const matches = getMatches(value)
  const showDropdown = matches.length > 0

  useInput((input, key) => {
    if (isLoading) return

    if (showDropdown) {
      if (key.upArrow) { setSelectedIdx((i) => (i - 1 + matches.length) % matches.length); return }
      if (key.downArrow) { setSelectedIdx((i) => (i + 1) % matches.length); return }
      if (key.tab || key.return) {
        const chosen = matches[selectedIdx]!
        if (key.return && value === chosen) { onSubmit(value); setValue(''); setSelectedIdx(0); return }
        setValue(chosen)
        setSelectedIdx(0)
        return
      }
      if (key.escape) { setValue(''); setSelectedIdx(0); return }
    } else {
      if (key.return) { onSubmit(value); setValue(''); return }
      if (key.escape) { setValue(''); return }
    }

    if (key.backspace || key.delete) { setValue((v) => v.slice(0, -1)); setSelectedIdx(0); return }
    if (input && !key.ctrl && !key.meta) { setValue((v) => v + input); setSelectedIdx(0) }
  })

  return (
    <Box flexDirection="column">
      {isLoading ? <LoadingSpinner /> : (
        <Box>
          <Text color="green">{`> `}</Text>
          <Text>{value}</Text>
          <Text color="gray">█</Text>
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
