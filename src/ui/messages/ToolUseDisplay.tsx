import { useState, useEffect } from 'react'
import type { ToolStatus } from '../App.js'
import { TOOL_DISPLAY, TOOL_STYLE } from './toolDisplay.js'
import { getThemeColors, STATUS_ICONS } from '../theme.js'
import type { ThemeName } from '../theme.js'
import { useClock } from '../clock.js'
import Box from '../../ink/components/Box.js'
import Text from '../../ink/components/Text.js'

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

export function ToolUseDisplay({ tool, theme = 'dark' }: { tool: ToolStatus; theme?: ThemeName }) {
  const colors = getThemeColors(theme)
  const display = TOOL_DISPLAY[tool.name] ?? tool.name
  const rawArg = tool.done ? (tool.result ?? '') : (tool.args ?? '')
  const arg = rawArg.length > 60 ? rawArg.slice(0, 60) + '…' : rawArg

  const tick = useClock()
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    setElapsed(0)
    if (tool.done) return
    const t = setInterval(() => setElapsed((s) => s + 1), 1000)
    return () => clearInterval(t)
  }, [tool.name, tool.done])

  const style = TOOL_STYLE[display] || { icon: '▸', color: colors.textDim }

  // Status-aware icon
  const icon = tool.done
    ? ('error' in tool && tool.error ? STATUS_ICONS.error : STATUS_ICONS.success)
    : SPINNER_FRAMES[tick % SPINNER_FRAMES.length]

  // Status-aware color
  const iconColor = tool.done
    ? ('error' in tool && tool.error ? colors.error : colors.success)
    : colors.primary

  return (
    <Box flexDirection="row" paddingLeft={2} gap={1}>
      <Text color={iconColor}>{icon}</Text>
      <Text color={style.color}>{display}</Text>
      {arg ? <Text color={colors.textSubtle}>{arg}</Text> : null}
      {!tool.done && elapsed > 0 && <Text color={colors.textDim}>{elapsed + 's'}</Text>}
    </Box>
  )
}
