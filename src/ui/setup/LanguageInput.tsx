import React, { useState } from 'react'
import { Box, Text, useInput } from 'ink'

interface Props {
  currentLanguage: string | null
  onDone(language: string): void
  onCancel(): void
}

export function LanguageInput({ currentLanguage, onDone, onCancel }: Props) {
  const [input, setInput] = useState('')

  useInput((char, key) => {
    if (key.escape)  { onCancel(); return }
    if (key.return)  {
      const lang = input.trim()
      if (lang) onDone(lang)
      return
    }
    if (key.backspace || key.delete) { setInput((s) => s.slice(0, -1)); return }
    if (!key.ctrl && !key.meta && char) setInput((s) => s + char)
  })

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text dimColor>/language</Text>
      <Box marginTop={1} gap={1}>
        <Text color="cyan">{'>'}</Text>
        <Text>{input}</Text>
        <Text color="cyan">█</Text>
        {!input && <Text dimColor>type your preferred language (e.g. Portuguese, English…)</Text>}
      </Box>
      {currentLanguage && (
        <Box marginTop={0}>
          <Text dimColor>  current: {currentLanguage}</Text>
        </Box>
      )}
      <Box marginTop={1}><Text dimColor>{'─'.repeat(60)}</Text></Box>
      <Text dimColor>Enter confirm · Esc cancel</Text>
    </Box>
  )
}
