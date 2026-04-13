import React, { useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { homedir } from 'os'
import { join } from 'path'
import type { ThemeName } from './ApiKeySetup.js'

const THEMES: { label: string; value: ThemeName }[] = [
  { label: 'Dark mode', value: 'dark' },
  { label: 'Light mode', value: 'light' },
  { label: 'Dark mode (colorblind-friendly)', value: 'dark-daltonized' },
  { label: 'Light mode (colorblind-friendly)', value: 'light-daltonized' },
  { label: 'Dark mode (ANSI colors only)', value: 'dark-ansi' },
  { label: 'Light mode (ANSI colors only)', value: 'light-ansi' },
]

const DIFF_COLORS: Record<ThemeName, { added: string; removed: string; addedWord: string; removedWord: string }> = {
  'dark':             { added: 'rgb(34,92,43)',    removed: 'rgb(122,41,54)',  addedWord: 'rgb(56,166,96)',  removedWord: 'rgb(179,89,107)' },
  'light':            { added: 'rgb(105,219,124)', removed: 'rgb(255,168,180)',addedWord: 'rgb(47,157,68)', removedWord: 'rgb(209,69,75)'  },
  'dark-daltonized':  { added: 'rgb(0,68,102)',    removed: 'rgb(102,0,0)',    addedWord: 'rgb(0,119,179)', removedWord: 'rgb(179,0,0)'    },
  'light-daltonized': { added: 'rgb(153,204,255)', removed: 'rgb(255,204,204)',addedWord: 'rgb(51,102,204)',removedWord: 'rgb(153,51,51)'  },
  'dark-ansi':        { added: 'green',            removed: 'red',             addedWord: 'greenBright',    removedWord: 'redBright'       },
  'light-ansi':       { added: 'green',            removed: 'red',             addedWord: 'greenBright',    removedWord: 'redBright'       },
}

const CONFIG_PATH = join(homedir(), '.deepseek-code', 'config.json')

async function saveTheme(theme: ThemeName): Promise<void> {
  const existing = await Bun.file(CONFIG_PATH).json().catch(() => ({}))
  await Bun.write(CONFIG_PATH, JSON.stringify({ ...existing, THEME: theme }, null, 2))
}

interface Props {
  currentTheme: ThemeName
  onSelect(theme: ThemeName): void
  onCancel(): void
}

export function ThemeSelector({ currentTheme, onSelect, onCancel }: Props) {
  const [idx, setIdx] = useState(() => THEMES.findIndex((t) => t.value === currentTheme) || 0)
  const preview = THEMES[idx]!.value
  const c = DIFF_COLORS[preview]

  useInput(async (_, key) => {
    if (key.upArrow) { setIdx((i) => (i - 1 + THEMES.length) % THEMES.length); return }
    if (key.downArrow) { setIdx((i) => (i + 1) % THEMES.length); return }
    if (key.return) {
      await saveTheme(preview)
      onSelect(preview)
      return
    }
    if (key.escape) { onCancel(); return }
  })

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text dimColor>/theme</Text>
      <Box flexDirection="column" marginTop={1}>
        {THEMES.map((t, i) => (
          <Box key={t.value} gap={2}>
            <Text color={i === idx ? 'cyan' : undefined} bold={i === idx}>
              {i === idx ? '❯ ' : '  '}{t.label}
            </Text>
            {t.value === currentTheme && <Text dimColor>[active]</Text>}
          </Box>
        ))}
      </Box>
      <Text dimColor marginTop={1}>{'─'.repeat(60)}</Text>
      <Text dimColor>ESC to cancel · ↑↓ to navigate</Text>
      <Text dimColor marginTop={1}>{'─'.repeat(60)}</Text>
      <Box flexDirection="column" marginTop={1}>
        <Text dimColor>Preview</Text>
        <Box marginTop={1} flexDirection="column">
          <Text dimColor>Code diff — added and removed lines will look like:</Text>
          <Text backgroundColor={c.added} color={c.addedWord}>{'+ const result = compute(input);'}</Text>
          <Text backgroundColor={c.removed} color={c.removedWord}>{'- const result = calculate(input);'}</Text>
        </Box>
      </Box>
    </Box>
  )
}
