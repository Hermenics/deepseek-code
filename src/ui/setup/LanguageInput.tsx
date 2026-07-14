import { useState } from 'react'
import useInput from '../../ink/hooks/use-input.js'
import type { Key } from '../../ink/events/input-event.js'
import Box from '../../ink/components/Box.js'
import Text from '../../ink/components/Text.js'

interface Props {
  currentLanguage: string | null
  onDone(language: string): void
  onCancel(): void
}

export function LanguageInput({ currentLanguage, onDone, onCancel }: Props) {
  const [value, setValue] = useState('')

  useInput((ch: string, key: Key) => {
    if (key.escape) { onCancel(); return }
    if (key.return) {
      const lang = value.trim()
      if (lang) onDone(lang)
      return
    }
    if (key.backspace || key.delete) { setValue((s) => s.slice(0, -1)); return }
    if (!key.ctrl && !key.meta && ch && ch.length >= 1) setValue((s) => s + ch)
  })

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color="#888888">/language</Text>
      <Box marginTop={1} flexDirection="row" gap={1}>
        <Text color="cyan">{'>'}</Text>
        <Text>{value}</Text>
        <Text color="cyan">█</Text>
        {!value && <Text color="#888888">type your preferred language (e.g. Portuguese, English…)</Text>}
      </Box>
      {currentLanguage && (
        <Box marginTop={0}>
          <Text color="#888888">  current: {currentLanguage}</Text>
        </Box>
      )}
      <Box marginTop={1}><Text color="#888888">{'─'.repeat(60)}</Text></Box>
      <Text color="#888888">Enter confirm · Esc cancel</Text>
    </Box>
  )
}
