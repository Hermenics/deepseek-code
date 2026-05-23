import { useState, useEffect } from 'react'
import type { ToolStatus } from '../App.js'
import { TOOL_DISPLAY, TOOL_STYLE } from './toolDisplay.js'
import { useClock } from '../clock.js'
import Box from '../../ink/components/Box.js'
import Text from '../../ink/components/Text.js'

const SPINNER_CW = ['◐', '◓', '◑', '◒']

export function ToolUseDisplay({ tool }: { tool: ToolStatus }) {
  const display = TOOL_DISPLAY[tool.name] ?? tool.name
  const rawArg = tool.done ? (tool.result ?? '') : (tool.args ?? '')
  const arg = rawArg.length > 60 ? rawArg.slice(0, 60) + '…' : rawArg

  const tick = useClock()
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    // Reset elapsed when a new tool starts
    setElapsed(0)
    if (tool.done) return
    const t = setInterval(() => setElapsed((s) => s + 1), 1000)
    return () => clearInterval(t)
  }, [tool.name, tool.done])

  const style = TOOL_STYLE[display] || { icon: '▸', color: '#888888' }
  const icon = tool.done ? style.icon : SPINNER_CW[tick % SPINNER_CW.length]
  const iconColor = tool.done ? style.color : 'cyan'

  return (
    <Box flexDirection="row" paddingLeft={2} gap={1}>
      <Text color={iconColor}>{icon}</Text>
      <Text color={style.color}>{display}</Text>
      {arg ? <Text color="#666666">{arg}</Text> : null}
      {!tool.done && elapsed > 0 && <Text color="#888888">{elapsed + 's'}</Text>}
    </Box>
  )
}
