import React, { useState } from 'react'
import { Box, Text, useInput } from 'ink'
import type { Model } from '../../commands.js'

const MODELS: { value: Model; label: string; description: string }[] = [
  {
    value: 'deepseek-chat',
    label: 'DeepSeek V3',
    description: 'Fast, general purpose · 128K context',
  },
  {
    value: 'deepseek-reasoner',
    label: 'DeepSeek R1',
    description: 'Chain-of-thought reasoning · best for complex problems',
  },
]

interface Props {
  currentModel: Model
  onSelect(model: Model): void
  onCancel(): void
}

export function ModelSelector({ currentModel, onSelect, onCancel }: Props) {
  const [idx, setIdx] = useState(() => Math.max(0, MODELS.findIndex((m) => m.value === currentModel)))

  useInput((_, key) => {
    if (key.upArrow)   { setIdx((i) => (i - 1 + MODELS.length) % MODELS.length); return }
    if (key.downArrow) { setIdx((i) => (i + 1) % MODELS.length); return }
    if (key.return)    { onSelect(MODELS[idx]!.value); return }
    if (key.escape)    { onCancel(); return }
  })

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text dimColor>/models</Text>
      <Box flexDirection="column" marginTop={1}>
        {MODELS.map((m, i) => (
          <Box key={m.value} gap={2}>
            <Text color={i === idx ? 'cyan' : undefined} bold={i === idx}>
              {i === idx ? '❯ ' : '  '}{m.label}
            </Text>
            <Text dimColor={i !== idx} color={i === idx ? 'cyan' : undefined}>
              {m.description}
            </Text>
            {m.value === currentModel && <Text dimColor>[active]</Text>}
          </Box>
        ))}
      </Box>
      <Box marginTop={1}><Text dimColor>{'─'.repeat(60)}</Text></Box>
      <Text dimColor>↑↓ navigate · Enter select · Esc cancel</Text>
    </Box>
  )
}
