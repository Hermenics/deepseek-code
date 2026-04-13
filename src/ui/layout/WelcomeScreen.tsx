import React, { useEffect, useState } from 'react'
import { Box, Text } from 'ink'

export function WelcomeArt() {
  return (
    <Box flexDirection="column">
      <Text><Text color="cyan">{'Welcome to DeepSeek Code'} </Text><Text dimColor>{'v0.1.0'}</Text></Text>
      <Box marginTop={1} flexDirection="column">
        <Text dimColor>{'  *          .        *             .       *          .*          .   '}</Text>
        <Text dimColor>{'       .          *         .              *               .              *'}</Text>
        <Text dimColor>{'  .       *              .        *               .       *               . '}</Text>
        <Text dimColor>{'        .       *                    .        *       .    '}</Text>
        <Text dimColor>{'  *          .        *             .       *          .   '}</Text>
        <Text color="cyan">{'          ▄▄███▄▄'}<Text dimColor>{'    .        *       .      *        .  *       .      *        .  '}</Text></Text>
        <Text color="cyan">{'        ▄█ ◉    ██▄'}<Text dimColor>{'  *          .        *              .  *       .      *        .  '}</Text></Text>
        <Text color="cyan">{'        █          ~~█'}<Text dimColor>{'       *          .        *       .    *       .      *        .  '}</Text></Text>
        <Text dimColor>{'~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~'}</Text>
        <Text dimColor>{'~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~ '}</Text>
      </Box>
    </Box>
  )
}

interface Props {
  children: React.ReactNode
}

// Shows art always. After 1s, reveals children below it.
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
