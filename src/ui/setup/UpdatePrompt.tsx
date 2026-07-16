import { useState } from 'react'
import useInput from '../../ink/hooks/use-input.js'
import type { Key } from '../../ink/events/input-event.js'
import Box from '../../ink/components/Box.js'
import Text from '../../ink/components/Text.js'

interface Props {
  current: string
  latest: string
  onChoice: (choice: 'update' | 'skip' | 'dismiss') => void
}

const OPTIONS = ['update', 'skip', 'dismiss'] as const

export function UpdatePrompt({ current, latest, onChoice }: Props) {
  const [idx, setIdx] = useState(0)

  useInput((input: string, key: Key) => {
    if (key.upArrow) { setIdx(i => (i - 1 + OPTIONS.length) % OPTIONS.length); return }
    if (key.downArrow) { setIdx(i => (i + 1) % OPTIONS.length); return }
    if (key.return) { onChoice(OPTIONS[idx]!); return }
    if (key.escape || (key.ctrl && input === 'c')) { onChoice('skip'); return }
  })

  const labels: Record<typeof OPTIONS[number], string> = {
    update: `Update now (runs \`npm install -g @hermenics/deepseek-code@${latest}\`)`,
    skip: 'Skip',
    dismiss: "Don't ask again for this version",
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text>  ✨ Update available! {current} -{'>'} {latest}</Text>
      <Box flexDirection="column" marginTop={1}>
        {OPTIONS.map((opt, i) => (
          <Box key={opt}>
            <Text color={i === idx ? 'cyan' : undefined}>
              {i === idx ? '❯ ' : '  '}{labels[opt]}
            </Text>
          </Box>
        ))}
      </Box>
      <Box marginTop={1}>
        <Text color="#888888">↑↓ navigate · Enter select · Esc/Ctrl+C skip</Text>
      </Box>
    </Box>
  )
}
