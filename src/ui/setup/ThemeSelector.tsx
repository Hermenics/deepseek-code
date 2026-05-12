import { useState } from 'react'
import { useKeyboard } from '@opentui/react'
import type { KeyEvent } from '@opentui/core'
import { homedir } from 'os'
import { join } from 'path'
import type { ThemeName } from './ApiKeySetup.js'
import { readJson, writeRaw } from '../../utils/fs.js'

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

const CONFIG_PATH = join(homedir(), '.deepseek', 'config.json')

async function saveTheme(theme: ThemeName): Promise<void> {
  const existing = await readJson<Record<string, string>>(CONFIG_PATH).catch(() => ({}))
  await writeRaw(CONFIG_PATH, JSON.stringify({ ...existing, THEME: theme }, null, 2))
}

interface Props {
  currentTheme: ThemeName
  onSelect(theme: ThemeName): void
  onCancel(): void
}

export function ThemeSelector({ currentTheme, onSelect, onCancel }: Props) {
  const [idx, setIdx] = useState(() => Math.max(0, THEMES.findIndex((t) => t.value === currentTheme)))
  const preview = THEMES[idx]!.value
  const c = DIFF_COLORS[preview]

  useKeyboard((key: KeyEvent) => {
    if (key.name === 'up') { setIdx((i) => (i - 1 + THEMES.length) % THEMES.length); return }
    if (key.name === 'down') { setIdx((i) => (i + 1) % THEMES.length); return }
    if (key.name === 'return') {
      saveTheme(preview).then(() => onSelect(preview))
      return
    }
    if (key.name === 'escape') { onCancel(); return }
  })

  return (
    <box flexDirection="column" marginTop={1}>
      <text fg="#888888">/theme</text>
      <box flexDirection="column" marginTop={1}>
        {THEMES.map((t, i) => (
          <box key={t.value} flexDirection="row" gap={2}>
            <text fg={i === idx ? 'cyan' : undefined}>
              {i === idx ? '❯ ' : '  '}{t.label}
            </text>
            {t.value === currentTheme && <text fg="#888888">[active]</text>}
          </box>
        ))}
      </box>
      <box marginTop={1}><text fg="#888888">{'─'.repeat(60)}</text></box>
      <text fg="#888888">ESC to cancel · ↑↓ to navigate</text>
      <box marginTop={1}><text fg="#888888">{'─'.repeat(60)}</text></box>
      <box flexDirection="column" marginTop={1}>
        <text fg="#888888">Preview</text>
        <box marginTop={1} flexDirection="column">
          <text fg="#888888">Code diff — added and removed lines will look like:</text>
          <text bg={c.added} fg={c.addedWord}>{'+ const result = compute(input);'}</text>
          <text bg={c.removed} fg={c.removedWord}>{'- const result = calculate(input);'}</text>
        </box>
      </box>
    </box>
  )
}
