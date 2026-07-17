import { useState, useEffect } from 'react'
import useInput from '../../ink/hooks/use-input.js'
import type { Key } from '../../ink/events/input-event.js'
import Box from '../../ink/components/Box.js'
import Text from '../../ink/components/Text.js'

type EffortLevel = 'low' | 'high' | 'max'

const LEVELS: { level: EffortLevel; description: string }[] = [
  { level: 'low', description: 'Thinking disabled. Fast responses for simple tasks.' },
  { level: 'high', description: 'Thinking enabled. Balanced depth and speed.' },
  { level: 'max', description: 'Maximum reasoning depth. May use excessive tokens.' },
]

// Gradient animation colors per level — light → base → dark
const LEVEL_GRADIENTS: Record<EffortLevel, string[]> = {
  low: ['#66ffaa', '#00cc66', '#009944', '#006633', '#003d1f'],
  high: ['#cc99ff', '#aa66ff', '#8833dd', '#6611bb', '#440088'],
  max: ['#87CEEB', '#5B9BD5', '#2E75B6', '#1B4F8A', '#0D2B52'],
}

interface Props {
  currentLevel: EffortLevel
  onSelect(level: EffortLevel): void
  onCancel(): void
}

export function EffortSelector({ currentLevel, onSelect, onCancel }: Props) {
  const [idx, setIdx] = useState(() => {
    const i = LEVELS.findIndex((o) => o.level === currentLevel)
    return i >= 0 ? i : 1
  })

  // Animation frame for gradient
  const [animFrame, setAnimFrame] = useState(0)

  useEffect(() => {
    const timer = setInterval(() => {
      setAnimFrame((f) => (f + 1) % 5)
    }, 150)
    return () => clearInterval(timer)
  }, [idx])

  useInput((_input: string, key: Key) => {
    if (key.leftArrow) { setIdx((i) => Math.max(0, i - 1)); return }
    if (key.rightArrow) { setIdx((i) => Math.min(LEVELS.length - 1, i + 1)); return }
    if (key.return) { onSelect(LEVELS[idx]!.level); return }
    if (key.escape) { onCancel(); return }
  })

  const selected = LEVELS[idx]!

  // Layout: each label gets a fixed column width, track spans the full width
  const COL_WIDTH = 12
  const TRACK_WIDTH = COL_WIDTH * (LEVELS.length - 1) + 3

  // ▲ position: aligned to center of label text
  const markerPos = idx * COL_WIDTH + 1

  // Build track line with ▲ embedded in it
  const trackBefore = '─'.repeat(markerPos)
  const trackAfter = '─'.repeat(Math.max(0, TRACK_WIDTH - markerPos - 1))
  const trackWithMarker = trackBefore + '▲' + trackAfter

  // Animated gradient — colors shift each frame
  function renderGradient(text: string, level: EffortLevel) {
    const colors = LEVEL_GRADIENTS[level]
    return text.split('').map((char, i) => {
      const colorIdx = (i + animFrame) % colors.length
      return <Text key={i} color={colors[colorIdx]} bold>{char}</Text>
    })
  }

  return (
    <Box flexDirection="column" alignItems="center">
      {/* Title */}
      <Text bold color="white">Effort</Text>
      <Text>{' '}</Text>

      {/* Slider block — centered */}
      <Box flexDirection="column">
        {/* Header: Faster ... Smarter */}
        <Box>
          <Text color="#888888">{'Faster'}</Text>
          <Text>{' '.repeat(Math.max(1, TRACK_WIDTH - 11))}</Text>
          <Text color="#888888">{'Smarter'}</Text>
        </Box>

        {/* Track line with ▲ embedded */}
        <Box>
          <Text color="#666666">{trackWithMarker}</Text>
        </Box>

        {/* Labels */}
        <Box>
          {LEVELS.map((opt, i) => {
            const isSelected = i === idx
            const isLast = i === LEVELS.length - 1
            const padded = isLast ? opt.level : opt.level.padEnd(COL_WIDTH)
            if (isSelected) {
              const content = renderGradient(opt.level, opt.level)
              const pad = isLast ? null : <Text>{' '.repeat(COL_WIDTH - opt.level.length)}</Text>
              return <Box key={opt.level}>{content}{pad}</Box>
            }
            return (
              <Text key={opt.level} color={'#666666'}>
                {padded}
              </Text>
            )
          })}
        </Box>
      </Box>

      {/* Description */}
      {selected.description && (
        <Box marginTop={1}>
          <Text color="#888888">{selected.description}</Text>
        </Box>
      )}

      {/* Footer */}
      <Box marginTop={1}>
        <Text color="#666666">{'←/→ to adjust · Enter to confirm · Esc to cancel'}</Text>
      </Box>
    </Box>
  )
}
