import React, { useState, useEffect } from 'react'
import { Box, Text } from 'ink'
import type { ToolStatus } from '../App.js'
import { TOOL_DISPLAY } from './toolDisplay.js'
import { useClock } from '../clock.js'

// Spinner horário: ◐ ◓ ◑ ◒
const SPINNER_CW = ['◐', '◓', '◑', '◒']

export const ToolUseDisplay = React.memo(function ToolUseDisplay({ tool }: { tool: ToolStatus }) {
  const display = TOOL_DISPLAY[tool.name] ?? tool.name
  const rawArg = tool.done ? (tool.result ?? '') : (tool.args ?? '')
  const arg = rawArg.length > 60 ? rawArg.slice(0, 60) + '…' : rawArg

  const tick = useClock()
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (tool.done) return
    const t = setInterval(() => setElapsed((s) => s + 1), 1000)
    return () => clearInterval(t)
  }, [tool.done])

  const icon = tool.done
    ? <Text color="white" bold>●</Text>
    : <Text color="cyan" bold>{SPINNER_CW[tick % SPINNER_CW.length]}</Text>

  return (
    <Box paddingLeft={2} gap={1}>
      {icon}
      <Text bold>{display}</Text>
      {arg ? <Text dimColor>({arg})</Text> : null}
      {!tool.done && elapsed > 0 && <Text dimColor>{elapsed}s</Text>}
    </Box>
  )
})
