import { useState } from 'react'
import useInput from '../../ink/hooks/use-input.js'
import type { Key } from '../../ink/events/input-event.js'
import type { Model } from '../../commands.js'
import Box from '../../ink/components/Box.js'
import Text from '../../ink/components/Text.js'
import { formatModelLabel, getModelDescription } from '../../agent/modelInfo.js'

interface Props {
  currentModel: Model
  models: string[]
  descriptions?: Record<string, string>
  onSelect(model: Model): void
  onCancel(): void
}

export function ModelSelector({ currentModel, models, onSelect, onCancel, descriptions }: Props) {
  const [idx, setIdx] = useState(() => {
    const i = models.indexOf(currentModel)
    return i >= 0 ? i : 0
  })

  useInput((_input: string, key: Key) => {
    if (models.length === 0) {
      if (key.escape) { onCancel(); return }
      return
    }
    if (key.upArrow || _input === 'k') { setIdx((i) => (i - 1 + models.length) % models.length); return }
    if (key.downArrow || _input === 'j') { setIdx((i) => (i + 1) % models.length); return }
    if (key.return) { onSelect(models[idx]!); return }
    if (key.escape) { onCancel(); return }
  })

  if (models.length === 0) {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text bold>Select model</Text>
        <Box marginTop={1}>
          <Text color="yellow">No models available from this provider.</Text>
        </Box>
        <Text color="#888888">Esc to go back</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold>Select model</Text>
      <Text color="#888888">Switch between DeepSeek models. Applies to this session.</Text>
      <Box flexDirection="column" marginTop={1}>
        {models.map((m, i) => {
          const desc = descriptions?.[m] ?? getModelDescription(m)
          return (
            <Box key={m} flexDirection="row" gap={1}>
              <Box width={2}>
                <Text color={i === idx ? 'cyan' : undefined}>
                  {i === idx ? '❯' : ' '}
                </Text>
              </Box>
              <Box flexDirection="row" gap={1}>
                <Text color={i === idx ? 'cyan' : undefined}>
                  {formatModelLabel(m)}
                </Text>
                {desc && <Text color="#888888">{desc}</Text>}
              </Box>
              {m === currentModel && <Text color="#888888">[active]</Text>}
            </Box>
          )
        })}
      </Box>
      <Box marginTop={1}><Text color="#888888">{'─'.repeat(60)}</Text></Box>
      <Text color="#888888">↑↓ j/k navigate · Enter select · Esc cancel</Text>
    </Box>
  )
}
