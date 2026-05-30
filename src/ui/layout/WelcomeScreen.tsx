import { useState, useEffect } from 'react'
import pkg from '../../../package.json' with { type: 'json' }
import Box from '../../ink/components/Box.js'
import Text from '../../ink/components/Text.js'

export function DeepSeekMascot() {
  return (
    <Box flexDirection="column">
      <Text color="cyan">{' ▄▄███▄▄'}</Text>
      <Text color="cyan">{'▄█ ◉    ██▄'}</Text>
      <Text color="cyan">{'█          ~~█'}</Text>
      <Text color="cyan">{'▀▄▄█▄▄▄▄█▀'}</Text>
    </Box>
  )
}

export function WelcomeArt() {
  const cols = process.stdout.columns ?? 80
  const isNarrow = cols < 100

  if (isNarrow) {
    return (
      <Box flexDirection="column" marginBottom={1} marginTop={1}>
        <Box flexDirection="row" gap={2}>
          <DeepSeekMascot />
          <Box flexDirection="column">
            <Box flexDirection="row" gap={1}>
              <Text color="cyan">{'◆ DeepSeek Code'}</Text>
              <Text color="#888888">{'v' + pkg.version}</Text>
            </Box>
            <Text color="#5599ff">Deep reasoning, hello world.</Text>
            <Text color="#888888">Elite code.</Text>
          </Box>
        </Box>
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" gap={1}>
        <Text color="cyan">{'Welcome to DeepSeek Code'}</Text>
        <Text color="#888888">{'v' + pkg.version}</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text color="#888888">{'  *          .        *             .       *          .*          .   '}</Text>
        <Text color="#888888">{'       .          *         .              *               .              *'}</Text>
        <Text color="#888888">{'  .       *              .        *               .       *               . '}</Text>
        <Text color="#888888">{'        .       *                    .        *       .    '}</Text>
        <Text color="#888888">{'  *          .        *             .       *          .   '}</Text>
        <Box flexDirection="row">
          <Text color="cyan">{'          ▄▄███▄▄'}</Text>
          <Text color="#888888">{'    .        *       .      *        .  *       .      *        .  '}</Text>
        </Box>
        <Box flexDirection="row">
          <Text color="cyan">{'        ▄█ ◉    ██▄'}</Text>
          <Text color="#888888">{'  *          .        *              .  *       .      *        .  '}</Text>
        </Box>
        <Box flexDirection="row">
          <Text color="cyan">{'        █          ~~█'}</Text>
          <Text color="#888888">{'       *          .        *       .    *       .      *        .  '}</Text>
        </Box>
        <Text color="#888888">{'~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~'}</Text>
        <Text color="#888888">{'~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~ '}</Text>
      </Box>
    </Box>
  )
}

interface WelcomeScreenProps {
  children: React.ReactNode
}

export function WelcomeScreen({ children }: WelcomeScreenProps) {
  const [showChildren, setShowChildren] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setShowChildren(true), 50)
    return () => clearTimeout(t)
  }, [])

  return (
    <Box flexDirection="column">
      <WelcomeArt />
      {showChildren && children}
    </Box>
  )
}
