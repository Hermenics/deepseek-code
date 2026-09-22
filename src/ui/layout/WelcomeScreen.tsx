import { useState, useEffect } from 'react'
import pkg from '../../../package.json' with { type: 'json' }
import Box from '../../ink/components/Box.js'
import Text from '../../ink/components/Text.js'
import { getThemeColors } from '../theme.js'
import type { ThemeName } from '../theme.js'

/** Four-line ASCII whale mascot in the theme's brand colors. */
export function DeepSeekMascot({ theme = 'dark' }: { theme?: ThemeName }) {
  const colors = getThemeColors(theme)
  return (
    <Box flexDirection="column">
      <Text color={colors.primary}>{'  ▄▄███▄▄'}</Text>
      <Text color={colors.h2}>{' ▄█ ◉    ██▄'}</Text>
      <Text color={colors.primary}>{'█          ~~█'}</Text>
      <Text color={colors.h2}>{' ▀▄▄█▄▄▄▄█▀'}</Text>
    </Box>
  )
}

/** Startup banner with name and version: a compact mascot-plus-tagline layout under 100 columns, otherwise the full starfield-and-waves scene. */
export function WelcomeArt({ theme = 'dark' }: { theme?: ThemeName }) {
  const colors = getThemeColors(theme)
  const cols = process.stdout.columns ?? 80
  const isNarrow = cols < 100

  if (isNarrow) {
    return (
      <Box flexDirection="column" marginBottom={1} marginTop={1}>
        <Box flexDirection="row" gap={2}>
          <DeepSeekMascot theme={theme} />
          <Box flexDirection="column">
            <Box flexDirection="row" gap={1}>
              <Text color={colors.primary}>{'◆ DeepSeek Code'}</Text>
              <Text color={colors.textDim}>{'v' + pkg.version}</Text>
            </Box>
            <Text color={colors.h2}>Deep reasoning,</Text>
            <Text color={colors.h3}>Elite code.</Text>
          </Box>
        </Box>
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" gap={1}>
        <Text color={colors.primary}>{'Welcome to DeepSeek Code'}</Text>
        <Text color={colors.textDim}>{'v' + pkg.version}</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text color={colors.textSubtle}>{'  *          .        *             .       *          .*          .   '}</Text>
        <Text color={colors.textInactive}>{'       .          *         .              *               .              *'}</Text>
        <Text color={colors.textSubtle}>{'  .       *              .        *               .       *               . '}</Text>
        <Text color={colors.textInactive}>{'        .       *                    .        *       .    '}</Text>
        <Text color={colors.textSubtle}>{'  *          .        *             .       *          .   '}</Text>
        <Box flexDirection="row">
          <Text color={colors.primary}>{'          ▄▄███▄▄'}</Text>
          <Text color={colors.textInactive}>{'    .        *       .      *        .  *       .      *        .  '}</Text>
        </Box>
        <Box flexDirection="row">
          <Text color={colors.h2}>{'        ▄█ ◉    ██▄'}</Text>
          <Text color={colors.textSubtle}>{'  *          .        *              .  *       .      *        .  '}</Text>
        </Box>
        <Box flexDirection="row">
          <Text color={colors.primary}>{'        █          ~~█'}</Text>
          <Text color={colors.textInactive}>{'       *          .        *       .    *       .      *        .  '}</Text>
        </Box>
        <Text color="#888888">{'~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~'}</Text>
        <Text color="#888888">{'~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~ '}</Text>
      </Box>
    </Box>
  )
}

interface WelcomeScreenProps {
  children: React.ReactNode
  theme?: ThemeName
}

/** Shows the welcome banner and mounts its children one tick (50ms) later so the banner paints first. */
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
