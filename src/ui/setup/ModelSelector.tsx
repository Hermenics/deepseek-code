import { useState } from 'react'
import useInput from '../../ink/hooks/use-input.js'
import type { Key } from '../../ink/events/input-event.js'
import type { Model } from '../../commands.js'
import Box from '../../ink/components/Box.js'
import Text from '../../ink/components/Text.js'
import { formatModelLabel, getModelDescription, isGenericModelDescription } from '../../agent/modelInfo.js'
import { formatContextLimit } from '../../agent/cost.js'

interface Props {
  currentModel: Model
  models: string[]
  descriptions?: Record<string, string>
  columns?: number
  getContextLimit?: (model: string) => number | undefined
  onSelect(model: Model): void
  onCancel(): void
}

export function ModelSelector({ currentModel, models, onSelect, onCancel, descriptions, columns = process.stdout.columns ?? 80, getContextLimit }: Props) {
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
      <Text color="#888888">Switch between available models. Applies to this session.</Text>
      <Box flexDirection="column" marginTop={1}>
        {models.map((m, i) => {
          const contextLimit = getContextLimit?.(m)
          const supplied = descriptions?.[m]
          const desc = supplied && !isGenericModelDescription(supplied)
            ? contextLimit && !/\bcontext\b/i.test(supplied) ? `${supplied} · ${formatContextLimit(contextLimit)}` : supplied
            : getModelDescription(m, contextLimit) || `No verified description · ${contextLimit ? formatContextLimit(contextLimit) : 'context unknown'}`
          const rowWidth = Math.max(1, columns >= 42 ? Math.min(columns, Math.max(40, columns - 2)) : columns)
          const activeWidth = rowWidth >= 42 ? 9 : 0
          const prefixWidth = Math.min(2, rowWidth)
          const nameWidth = Math.min(
            Math.max(0, rowWidth - prefixWidth - activeWidth),
            Math.min(34, Math.max(20, Math.floor(rowWidth * 0.34))),
          )
          return (
            <Box key={m} flexDirection="row" width={rowWidth}>
              <Box width={prefixWidth} flexShrink={0}>
                <Text color={i === idx ? 'cyan' : undefined}>
                  {i === idx ? '❯' : ' '}
                </Text>
              </Box>
              <Box width={nameWidth} flexShrink={0}>
                <Text color={i === idx ? 'cyan' : undefined} wrap="truncate-end">
                  {formatModelLabel(m)}
                </Text>
              </Box>
              <Box flexGrow={1} flexShrink={1}>
                <Text color="#888888" wrap="truncate-end">{desc}</Text>
              </Box>
              {activeWidth > 0 && <Box width={activeWidth} flexShrink={0}>
                <Text color="#888888">{m === currentModel ? '[active]' : ''}</Text>
              </Box>}
            </Box>
          )
        })}
      </Box>
      <Box marginTop={1}><Text color="#888888">{'─'.repeat(Math.min(60, Math.max(1, columns - 2)))}</Text></Box>
      <Text color="#888888">↑↓ j/k navigate · Enter select · Esc cancel</Text>
    </Box>
  )
}
