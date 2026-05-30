import { useState, useEffect } from 'react'
import pkg from '../../../package.json' with { type: 'json' }
import { getThemeColors, STATUS_ICONS, WELCOME_WIDTH, DIVIDER_CHAR } from '../theme.js'
import type { ThemeName } from '../theme.js'
import Box from '../../ink/components/Box.js'
import Text from '../../ink/components/Text.js'

export function DeepSeekMascot({ color }: { color?: string }) {
  const c = color ?? 'rgb(85,153,255)'
  return (
    <Box flexDirection="column">
      <Text color={c}>{'  ▄▄███▄▄'}</Text>
      <Text color={c}>{'▄█ ◉    ██▄'}</Text>
      <Text color={c}>{'█          ~~█'}</Text>
      <Text color={c}>{' ▀▄▄█▄▄▄▄█▀'}</Text>
    </Box>
  )
}

export function WelcomeArt({ theme = 'dark' }: { theme?: ThemeName }) {
  const colors = getThemeColors(theme)
  const cols = process.stdout.columns ?? 80
  const isNarrow = cols < 70
  const width = Math.min(cols - 4, WELCOME_WIDTH)

  if (isNarrow) {
    return (
      <Box flexDirection="column" marginBottom={1} marginTop={1}>
        <Box flexDirection="row" gap={2}>
          <DeepSeekMascot color={colors.primary} />
          <Box flexDirection="column">
            <Box flexDirection="row" gap={1}>
              <Text color={colors.primary}>{STATUS_ICONS.agent + ' DeepSeek Code'}</Text>
              <Text color={colors.textDim}>{'v' + pkg.version}</Text>
            </Box>
            <Text color={colors.suggestion}>Deep reasoning, elite code.</Text>
          </Box>
        </Box>
      </Box>
    )
  }

  const divider = DIVIDER_CHAR.repeat(width)

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color={colors.textDim}>{divider}</Text>
      <Box flexDirection="row" gap={1} marginTop={1}>
        <Text color={colors.primary}>{'Welcome to DeepSeek Code'}</Text>
        <Text color={colors.textDim}>{'v' + pkg.version}</Text>
      </Box>
      <Box marginTop={1} flexDirection="row" gap={3}>
        <DeepSeekMascot color={colors.primary} />
        <Box flexDirection="column" gap={1}>
          <Text color={colors.suggestion}>Deep reasoning, elite code.</Text>
          <Box flexDirection="column">
            <Text color={colors.textDim}>{'  *    .    *        .    *'}</Text>
            <Text color={colors.textDim}>{'    .    *      .        .   *'}</Text>
            <Text color={colors.textDim}>{'  *        .    *    .       .'}</Text>
          </Box>
        </Box>
      </Box>
      <Box marginTop={1}>
        <Text color={colors.textDim}>{divider}</Text>
      </Box>
    </Box>
  )
}

interface WelcomeScreenProps {
  children: React.ReactNode
  theme?: ThemeName
}

export function WelcomeScreen({ children, theme = 'dark' }: WelcomeScreenProps) {
  const [showChildren, setShowChildren] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setShowChildren(true), 50)
    return () => clearTimeout(t)
  }, [])

  return (
    <Box flexDirection="column">
      <WelcomeArt theme={theme} />
      {showChildren && children}
    </Box>
  )
}
