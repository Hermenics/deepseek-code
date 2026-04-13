import React, { useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { homedir } from 'os'
import { join } from 'path'
import { WelcomeScreen } from './WelcomeScreen.js'

const CONFIG_PATH = join(homedir(), '.deepseek-code', 'config.json')

export type ThemeName = 'dark' | 'light' | 'dark-daltonized' | 'light-daltonized' | 'dark-ansi' | 'light-ansi'

const THEMES: { label: string; value: ThemeName }[] = [
  { label: 'Dark mode', value: 'dark' },
  { label: 'Light mode', value: 'light' },
  { label: 'Dark mode (colorblind-friendly)', value: 'dark-daltonized' },
  { label: 'Light mode (colorblind-friendly)', value: 'light-daltonized' },
  { label: 'Dark mode (ANSI colors only)', value: 'dark-ansi' },
  { label: 'Light mode (ANSI colors only)', value: 'light-ansi' },
]

// Diff colors per theme
const DIFF_COLORS: Record<ThemeName, { added: string; removed: string; addedWord: string; removedWord: string }> = {
  'dark':             { added: 'rgb(34,92,43)',    removed: 'rgb(122,41,54)',  addedWord: 'rgb(56,166,96)',   removedWord: 'rgb(179,89,107)' },
  'light':            { added: 'rgb(105,219,124)', removed: 'rgb(255,168,180)',addedWord: 'rgb(47,157,68)',   removedWord: 'rgb(209,69,75)'  },
  'dark-daltonized':  { added: 'rgb(0,68,102)',    removed: 'rgb(102,0,0)',    addedWord: 'rgb(0,119,179)',   removedWord: 'rgb(179,0,0)'    },
  'light-daltonized': { added: 'rgb(153,204,255)', removed: 'rgb(255,204,204)',addedWord: 'rgb(51,102,204)',  removedWord: 'rgb(153,51,51)'  },
  'dark-ansi':        { added: 'green',            removed: 'red',             addedWord: 'greenBright',      removedWord: 'redBright'       },
  'light-ansi':       { added: 'green',            removed: 'red',             addedWord: 'greenBright',      removedWord: 'redBright'       },
}

const DIFF_LINES = [
  { type: 'context', text: ' function greet() {' },
  { type: 'removed', text: '-  console.log("Hello, World!");' },
  { type: 'added',   text: '+  console.log("Hello, DeepSeek!");' },
  { type: 'context', text: ' }' },
]

function DiffPreview({ theme }: { theme: ThemeName }) {
  const c = DIFF_COLORS[theme]
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1} marginTop={1}>
      <Text dimColor>demo.js</Text>
      {DIFF_LINES.map((line, i) => (
        <Text key={i} backgroundColor={line.type === 'added' ? c.added : line.type === 'removed' ? c.removed : undefined}>
          {line.type === 'added'
            ? <Text color={c.addedWord}>{line.text}</Text>
            : line.type === 'removed'
            ? <Text color={c.removedWord}>{line.text}</Text>
            : <Text dimColor>{line.text}</Text>}
        </Text>
      ))}
    </Box>
  )
}

async function saveConfig(data: Record<string, string>): Promise<void> {
  const dir = join(homedir(), '.deepseek-code')
  await Bun.write(join(dir, '.gitkeep'), '')
  const existing = await Bun.file(CONFIG_PATH).json().catch(() => ({}))
  await Bun.write(CONFIG_PATH, JSON.stringify({ ...existing, ...data }, null, 2))
}

export async function loadSavedConfig(): Promise<{ apiKey: string | null; theme: ThemeName }> {
  try {
    const cfg = await Bun.file(CONFIG_PATH).json()
    return { apiKey: cfg.DEEPSEEK_API_KEY ?? null, theme: cfg.THEME ?? 'dark' }
  } catch {
    return { apiKey: null, theme: 'dark' }
  }
}

type Step = 'theme' | 'apikey' | 'done'

interface Props {
  onDone(theme: ThemeName): void
}

export function ApiKeySetup({ onDone }: Props) {
  const [step, setStep] = useState<Step>('theme')
  const [themeIdx, setThemeIdx] = useState(0)
  const [apiKey, setApiKey] = useState('')
  const [error, setError] = useState('')

  const selectedTheme = THEMES[themeIdx]!.value

  useInput(async (char, key) => {
    if (step === 'theme') {
      if (key.upArrow) { setThemeIdx((i) => (i - 1 + THEMES.length) % THEMES.length); return }
      if (key.downArrow) { setThemeIdx((i) => (i + 1) % THEMES.length); return }
      if (key.return) { setStep('apikey'); return }
      if (key.escape) process.exit(0)
      return
    }

    if (step === 'apikey') {
      if (key.return) {
        const trimmed = apiKey.trim()
        if (!trimmed) { setError('API key cannot be empty.'); return }
        try {
          await saveConfig({ DEEPSEEK_API_KEY: trimmed, THEME: selectedTheme })
          process.env.DEEPSEEK_API_KEY = trimmed
          setStep('done')
          setTimeout(() => onDone(selectedTheme), 500)
        } catch (e) {
          setError(`Failed to save: ${(e as Error).message}`)
        }
        return
      }
      if (key.backspace || key.delete) { setApiKey((s) => s.slice(0, -1)); setError(''); return }
      if (key.escape) { setStep('theme'); setApiKey(''); setError(''); return }
      if (!key.ctrl && !key.meta && char) { setApiKey((s) => s + char); setError('') }
    }
  })

  if (step === 'done') {
    return <Box marginTop={1}><Text color="green">✓ Saved! Starting DeepSeek Code…</Text></Box>
  }

  const themeContent = step === 'theme' || step === 'apikey' ? (
    step === 'theme' ? (
      <Box flexDirection="column" gap={1} marginTop={1}>
        <Text>Choose the text style that looks best with your terminal:</Text>
        <Box flexDirection="column">
          {THEMES.map((t, i) => (
            <Box key={t.value}>
              <Text color={i === themeIdx ? 'cyan' : undefined}>
                {i === themeIdx ? '❯ ' : '  '}{t.label}
              </Text>
            </Box>
          ))}
        </Box>
        <DiffPreview theme={selectedTheme} />
        <Text dimColor>↑↓ navigate · Enter select · Esc exit</Text>
      </Box>
    ) : (
      // apikey step
      <Box flexDirection="column" gap={1} marginTop={1}>
        <Text bold>Enter your DeepSeek API key</Text>
        <Text dimColor>Get one at: https://platform.deepseek.com/api_keys</Text>
        <Box marginTop={1}>
          <Text color="cyan">{'> '}</Text>
          <Text>{'•'.repeat(apiKey.length) || <Text dimColor>sk-...</Text>}</Text>
          <Text color="cyan">█</Text>
        </Box>
        {error
          ? <Text color="red">{error}</Text>
          : <Text dimColor>Enter to confirm · Esc to go back</Text>}
      </Box>
    )
  ) : null

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <WelcomeScreen>{themeContent}</WelcomeScreen>
    </Box>
  )
}
