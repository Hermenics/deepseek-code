import { useEffect, useState } from 'react'
import Box from '../../ink/components/Box.js'
import Text from '../../ink/components/Text.js'
import { getThemeColors } from '../theme.js'
import type { ThemeName } from '../theme.js'
import { DeepSeekMascot, WELCOME_OCEAN_COLOR, WELCOME_OCEAN_LINES, WELCOME_SKY_LINES } from './WelcomeScreen.js'

const SWIM_OFFSETS = [0, 2, 4, 6, 8, 10, 12, 10, 8, 6, 4, 2, 0, -2, -4, -6, -8, -10, -12, -10, -8, -6, -4, -2]
const MASCOT_WIDTH = 14

export function canShowHomeAnimation(columns: number, rows: number): boolean {
  return columns >= 70 && rows >= 24
}

export function EmptySessionScreen({
  active,
  draftActive,
  reducedMotion,
  columns,
  rows,
  theme,
}: {
  active: boolean
  draftActive: boolean
  reducedMotion: boolean
  columns: number
  rows: number
  theme: ThemeName
}) {
  const [swimFrame, setSwimFrame] = useState(0)
  const visible = active && !draftActive && canShowHomeAnimation(columns, rows)
  const colors = getThemeColors(theme)

  useEffect(() => {
    if (!visible || reducedMotion) return
    const timer = setInterval(() => setSwimFrame(current => (current + 1) % SWIM_OFFSETS.length), 450)
    return () => clearInterval(timer)
  }, [visible, reducedMotion])

  if (!visible) return null

  const sceneWidth = Math.min(columns - 8, WELCOME_OCEAN_LINES[0].length)
  const skyLines = rows < 30 ? WELCOME_SKY_LINES.filter((_, index) => index % 2 === 0) : WELCOME_SKY_LINES
  const swimOffset = reducedMotion ? 0 : SWIM_OFFSETS[swimFrame]!
  const maxWhaleStart = Math.max(0, sceneWidth - MASCOT_WIDTH)
  const whaleStart = Math.max(0, Math.min(maxWhaleStart, Math.floor(maxWhaleStart / 2) + swimOffset))

  return (
    <Box flexDirection="column" flexGrow={1} justifyContent="center" alignItems="center">
      <Box flexDirection="column" alignItems="center">
        {skyLines.map((line, index) => <Text key={index} color={index % 2 === 0 ? colors.textSubtle : colors.textInactive}>{line.slice(0, sceneWidth)}</Text>)}
        <Box flexDirection="row" width={sceneWidth}>
          <Text>{' '.repeat(whaleStart)}</Text>
          <DeepSeekMascot theme={theme} showTail={false} blink={!reducedMotion} />
        </Box>
        {WELCOME_OCEAN_LINES.map(line => <Text key={line} color={WELCOME_OCEAN_COLOR}>{line.slice(0, sceneWidth)}</Text>)}
        <Box marginTop={1}><Text color={colors.text} bold>{"Let's get into the code."}</Text></Box>
        <Text color={colors.textDim}>Ask a question, point to a file, or describe a change.</Text>
        <Box flexDirection="row" gap={2} marginTop={1}>
          <Text color={colors.textSubtle}>@ files</Text>
          <Text color={colors.textSubtle}>/ commands</Text>
          {columns >= 88 && <>
            <Text color={colors.textSubtle}>↑ history</Text>
            <Text color={colors.textSubtle}>! shell</Text>
          </>}
        </Box>
      </Box>
    </Box>
  )
}
