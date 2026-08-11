import { useState } from 'react'
import useInput from '../../ink/hooks/use-input.js'
import type { Key } from '../../ink/events/input-event.js'
import Box from '../../ink/components/Box.js'
import Text from '../../ink/components/Text.js'

interface Props {
  current: string
  latest: string
  packageManagers: readonly ('bun' | 'npm')[]
  onChoice: (choice: 'update' | 'skip' | 'dismiss') => void
}

const OPTIONS = ['update', 'skip', 'dismiss'] as const

export function UpdatePrompt({ current, latest, packageManagers, onChoice }: Props) {
  const [idx, setIdx] = useState(0)

  useInput((input: string, key: Key) => {
    if (key.upArrow) { setIdx(i => (i - 1 + OPTIONS.length) % OPTIONS.length); return }
    if (key.downArrow) { setIdx(i => (i + 1) % OPTIONS.length); return }
    if (key.return) { onChoice(OPTIONS[idx]!); return }
    if (key.escape || (key.ctrl && input === 'c')) { onChoice('skip'); return }
  })

  const labels: Record<typeof OPTIONS[number], string> = {
    update: packageManagers.length === 2
      ? 'Update now (updates the npm and Bun global packages in parallel)'
      : `Update now (runs \`${packageManagers[0]} ${packageManagers[0] === 'bun' ? 'add' : 'install'} -g @hermenics/deepseek-code@${latest}\`)`,
    skip: 'Skip',
    dismiss: "Don't ask again for this version",
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text>  ✨ Update available! {current} -{'>'} {latest}</Text>
      {packageManagers.length === 2 && <Text color="yellow">  ⚠ Installed globally with npm and Bun; both will be updated.</Text>}
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
