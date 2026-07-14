import { useState } from 'react'
import useInput from '../../ink/hooks/use-input.js'
import type { Key } from '../../ink/events/input-event.js'
import type { ThemeName } from '../../types/provider.js'
import Box from '../../ink/components/Box.js'
import Text from '../../ink/components/Text.js'
import { ThemeSelector } from './ThemeSelector.js'
import { LanguageInput } from './LanguageInput.js'

type View = 'menu' | 'theme' | 'language'

interface ConfigMenuProps {
  currentTheme: ThemeName
  currentLanguage: string | null
  enchantEnabled: boolean
  onThemeSelect(t: ThemeName): void
  onLanguageSet(lang: string): void
  onEnchantToggle(enabled: boolean): void
  onClose(): void
  onThemeChange?(t: ThemeName): void
}

const ITEMS = ['Prompt Enchantment', 'Language', 'Theme'] as const

export default function ConfigMenu({
  currentTheme,
  currentLanguage,
  enchantEnabled,
  onThemeSelect,
  onLanguageSet,
  onEnchantToggle,
  onClose,
  onThemeChange,
}: ConfigMenuProps) {
  const [view, setView] = useState<View>('menu')
  const [idx, setIdx] = useState(0)
  const [enchant, setEnchant] = useState(enchantEnabled)

  useInput((_input: string, key: Key) => {
    if (view !== 'menu') return
    if (key.upArrow || _input === 'k') { setIdx((i) => (i - 1 + ITEMS.length) % ITEMS.length); return }
    if (key.downArrow || _input === 'j') { setIdx((i) => (i + 1) % ITEMS.length); return }
    if (key.return) {
      if (idx === 0) {
        const next = !enchant
        setEnchant(next)
        onEnchantToggle(next)
      } else if (idx === 1) {
        setView('language')
      } else {
        setView('theme')
      }
      return
    }
    if (key.escape || _input === 'q') { onClose(); return }
  })

  if (view === 'theme') {
    return (
      <ThemeSelector
        currentTheme={currentTheme}
        onSelect={(t) => { onThemeSelect(t); setView('menu') }}
        onCancel={() => setView('menu')}
      />
    )
  }

  if (view === 'language') {
    return (
      <LanguageInput
        currentLanguage={currentLanguage}
        onDone={(lang) => { onLanguageSet(lang); setView('menu') }}
        onCancel={() => setView('menu')}
      />
    )
  }

  const itemValues = [
    enchant ? 'ON' : 'OFF',
    currentLanguage ?? 'not set',
    currentTheme,
  ]

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold>⚙ Settings</Text>
      <Box flexDirection="column" marginTop={1}>
        {ITEMS.map((label, i) => (
          <Box key={label} flexDirection="row" gap={1}>
            <Text color={i === idx ? 'green' : undefined} bold={i === idx}>
              {i === idx ? '❯' : ' '}
            </Text>
            <Text color={i === idx ? 'green' : undefined}>
              {label}
            </Text>
            <Text dimColor>[{itemValues[i]}]</Text>
          </Box>
        ))}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>↑↓ navigate  Enter select  Esc close</Text>
      </Box>
    </Box>
  )
}
