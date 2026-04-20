import React, { useEffect, useState } from 'react'
import { Box, Text } from 'ink'
import chalk from 'chalk'
import figures from 'figures'
import cliBoxes from 'cli-boxes'
import pkg from '../../../package.json' with { type: 'json' }
import { DeepSeekMascot } from './Mascot.js'

export function WelcomeArt() {
  const cols = process.stdout.columns ?? 80
  const isNarrow = cols < 94

  if (isNarrow) {
    // Compact version for narrow terminals
    return (
      <Box flexDirection="column" marginBottom={1} marginTop={1}>
        <Box gap={2} alignItems="center">
          <DeepSeekMascot />
          <Box flexDirection="column">
            <Box gap={1}>
              <Text bold color="cyan">{figures.lozenge} DeepSeek Code</Text>
              <Text dimColor>v{pkg.version}</Text>
            </Box>
            <Text color="blueBright" bold>Deep reasoning.</Text>
            <Text dimColor>Elite code.</Text>
          </Box>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>{cliBoxes.round.top.repeat(cols - 8)}</Text>
        </Box>
      </Box>
    )
  }

  // Full version for wide terminals
  const wave1 = '  *          .        *             .       *          .*          .   '
  const wave2 = '       .          *         .              *               .              *'
  const wave3 = '  .       *              .        *               .       *               . '
  const wave4 = '        .       *                    .        *       .    '
  const wave5 = '  *          .        *             .       *          .   '
  const shore = '~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~'
  const foam = '~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~ '

  const clip = (s: string) => s.slice(0, cols)

  return (
    <Box flexDirection="column">
      <Box gap={1}>
        <Text color="cyan">{'Welcome to DeepSeek Code'} </Text>
        <Text dimColor>v{pkg.version}</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text dimColor>{clip(wave1)}</Text>
        <Text dimColor>{clip(wave2)}</Text>
        <Text dimColor>{clip(wave3)}</Text>
        <Text dimColor>{clip(wave4)}</Text>
        <Text dimColor>{clip(wave5)}</Text>
        <Box>
          <Text color="cyan">{'          ▄▄███▄▄'}</Text>
          <Text dimColor>{clip('    .        *       .      *        .  *       .      *        .  ')}</Text>
        </Box>
        <Box>
          <Text color="cyan">{'        ▄█ ◉    ██▄'}</Text>
          <Text dimColor>{clip('  *          .        *              .  *       .      *        .  ')}</Text>
        </Box>
        <Box>
          <Text color="cyan">{'        █          ~~█'}</Text>
          <Text dimColor>{clip('       *          .        *       .    *       .      *        .  ')}</Text>
        </Box>
        <Text dimColor>{clip(shore)}</Text>
        <Text dimColor>{clip(foam)}</Text>
      </Box>
    </Box>
  )
}

interface Props {
  children: React.ReactNode
}

export function WelcomeScreen({ children }: Props) {
  const [showChildren, setShowChildren] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setShowChildren(true), 1000)
    return () => clearTimeout(t)
  }, [])

  return (
    <Box flexDirection="column">
      <WelcomeArt />
      {showChildren && children}
    </Box>
  )
}
