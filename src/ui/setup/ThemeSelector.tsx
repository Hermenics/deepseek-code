import { useState } from 'react'
import useInput from '../../ink/hooks/use-input.js'
import type { Key } from '../../ink/events/input-event.js'
import { homedir } from 'os'
import { join } from 'path'
import type { ThemeName } from '../../types/provider.js'
import { getThemeColors } from '../theme.js'
import { readJson, writeRaw } from '../../utils/fs.js'
import Box from '../../ink/components/Box.js'
import Text from '../../ink/components/Text.js'

const THEMES: { label: string; value: ThemeName }[] = [
  { label: 'Dark mode', value: 'dark' },
  { label: 'Light mode', value: 'light' },
  { label: 'Dark mode (colorblind-friendly)', value: 'dark-daltonized' },
  { label: 'Light mode (colorblind-friendly)', value: 'light-daltonized' },
  { label: 'Dark mode (ANSI colors only)', value: 'dark-ansi' },
  { label: 'Light mode (ANSI colors only)', value: 'light-ansi' },
]

const CONFIG_PATH = join(homedir(), '.deepseek', 'config.json')

/** Writes the theme as `THEME` into ~/.deepseek/config.json, preserving the file's other keys. */
async function saveTheme(theme: ThemeName): Promise<void> {
  const existing = await readJson<Record<string, string>>(CONFIG_PATH).catch(() => ({}))
  await writeRaw(CONFIG_PATH, JSON.stringify({ ...existing, THEME: theme }, null, 2))
}

interface Props {
  currentTheme: ThemeName
  onSelect(theme: ThemeName): void
  onCancel(): void
}

/** Theme picker that live-previews each theme's colors on a sample diff; Enter persists the choice before calling onSelect, Esc cancels. */
export function ThemeSelector({ currentTheme, onSelect, onCancel }: Props) {
  const [idx, setIdx] = useState(() => Math.max(0, THEMES.findIndex((t) => t.value === currentTheme)))
  const preview = THEMES[idx]!.value
  const colors = getThemeColors(preview)

  useInput((_input: string, key: Key) => {
    if (key.upArrow) { setIdx((i) => (i - 1 + THEMES.length) % THEMES.length); return }
    if (key.downArrow) { setIdx((i) => (i + 1) % THEMES.length); return }
    if (key.return) {
      saveTheme(preview).then(() => onSelect(preview))
      return
    }
    if (key.escape) { onCancel(); return }
  })

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color={colors.primary} bold>Theme</Text>
      <Text bold>Choose the text style that looks best with your terminal</Text>

      {/* Side-by-side: selector on left, diff preview on right */}
      <Box flexDirection="row" marginTop={1} gap={3}>
        {/* Theme list (left) */}
        <Box flexDirection="column">
          {THEMES.map((t, i) => (
            <Box key={t.value} flexDirection="row" gap={1}>
              <Text color={i === idx ? colors.primary : colors.textDim}>
                {i === idx ? '❯' : ' '}
              </Text>
              <Text color={i === idx ? colors.primary : undefined}>
                {t.label}
              </Text>
              {t.value === currentTheme && <Text color={colors.textSubtle}> [active]</Text>}
            </Box>
          ))}
        </Box>

        {/* Separator */}
        <Box flexDirection="column">
          {Array.from({ length: 8 }).map((_, i) => (
            <Text key={i} color={colors.rule}>{'│'}</Text>
          ))}
        </Box>

        {/* Diff preview (right) */}
        <Box flexDirection="column">
          <Text color={colors.textSubtle} italic>{'Preview — demo.js'}</Text>
          <Text color={colors.textDim}>{' function greet() {'}</Text>
          <Text backgroundColor={colors.diffRemoved} color={colors.diffRemovedWord}>{'-  console.log("Hello, World!");'}</Text>
          <Text backgroundColor={colors.diffAdded} color={colors.diffAddedWord}>{'+  console.log("Hello, DeepSeek!");'}</Text>
          <Text color={colors.textDim}>{' }'}</Text>
        </Box>
      </Box>

      <Box marginTop={1}>
        <Text color={colors.textDim} italic>{'Enter to select · ESC to cancel · ↑↓ to navigate'}</Text>
      </Box>
    </Box>
  )
}
