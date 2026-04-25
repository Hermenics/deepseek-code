import React, { useState } from 'react'
import { Box, Text, useInput } from 'ink'
import type { Model } from '../../commands.js'

interface Props {
  currentModel: Model
  models: string[]
  onSelect(model: Model): void
  onCancel(): void
}

export function ModelSelector({ currentModel, models, onSelect, onCancel }: Props) {
  const [idx, setIdx] = useState(() => {
    const i = models.indexOf(currentModel)
    return i >= 0 ? i : 0
  })

  useInput((_, key) => {
    if (models.length === 0) {
      if (key.escape) { onCancel(); return }
      return
    }
    if (key.upArrow)   { setIdx((i) => (i - 1 + models.length) % models.length); return }
    if (key.downArrow) { setIdx((i) => (i + 1) % models.length); return }
    if (key.return)    { onSelect(models[idx]!); return }
    if (key.escape)    { onCancel(); return }
  })

  if (models.length === 0) {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text dimColor>/models</Text>
        <Box marginTop={1}>
          <Text color="yellow">No models available from this provider.</Text>
        </Box>
        <Text dimColor>Esc to go back</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text dimColor>/models</Text>
      <Box flexDirection="column" marginTop={1}>
        {models.map((m, i) => (
          <Box key={m} gap={2}>
            <Text color={i === idx ? 'cyan' : undefined} bold={i === idx}>
              {i === idx ? '❯ ' : '  '}{m}
            </Text>
            {m === currentModel && <Text dimColor>[active]</Text>}
          </Box>
        ))}
      </Box>
      <Box marginTop={1}><Text dimColor>{'─'.repeat(60)}</Text></Box>
      <Text dimColor>↑↓ navigate · Enter select · Esc cancel</Text>
    </Box>
  )
}
