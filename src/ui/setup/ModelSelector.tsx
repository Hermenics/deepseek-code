import { useState } from 'react'
import useInput from '../../ink/hooks/use-input.js'
import type { Key } from '../../ink/events/input-event.js'
import type { Model } from '../../commands.js'
import Box from '../../ink/components/Box.js'
import Text from '../../ink/components/Text.js'

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

  useInput((_input: string, key: Key) => {
    if (models.length === 0) {
      if (key.escape) { onCancel(); return }
      return
    }
    if (key.upArrow) { setIdx((i) => (i - 1 + models.length) % models.length); return }
    if (key.downArrow) { setIdx((i) => (i + 1) % models.length); return }
    if (key.return) { onSelect(models[idx]!); return }
    if (key.escape) { onCancel(); return }
  })

  if (models.length === 0) {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text color="#888888">/models</Text>
        <Box marginTop={1}>
          <Text color="yellow">No models available from this provider.</Text>
        </Box>
        <Text color="#888888">Esc to go back</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color="#888888">/models</Text>
      <Box flexDirection="column" marginTop={1}>
        {models.map((m, i) => (
          <Box key={m} flexDirection="row" gap={2}>
            <Text color={i === idx ? 'cyan' : undefined}>
              {i === idx ? '❯ ' : '  '}{m}
            </Text>
            {m === currentModel && <Text color="#888888">[active]</Text>}
          </Box>
        ))}
      </Box>
      <Box marginTop={1}><Text color="#888888">{'─'.repeat(60)}</Text></Box>
      <Text color="#888888">↑↓ navigate · Enter select · Esc cancel</Text>
    </Box>
  )
}
