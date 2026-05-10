import { useState, useEffect } from 'react'
import type { ToolStatus } from '../App.js'
import { TOOL_DISPLAY } from './toolDisplay.js'
import { useClock } from '../clock.js'

const SPINNER_CW = ['◐', '◓', '◑', '◒']

export function ToolUseDisplay({ tool }: { tool: ToolStatus }) {
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

  const icon = tool.done ? '●' : SPINNER_CW[tick % SPINNER_CW.length]
  const iconColor = tool.done ? 'white' : 'cyan'

  return (
    <box flexDirection="row" paddingLeft={2} gap={1}>
      <text fg={iconColor}>{icon}</text>
      <text fg="white">{display}</text>
      {arg ? <text fg="#888888">{'(' + arg + ')'}</text> : null}
      {!tool.done && elapsed > 0 && <text fg="#888888">{elapsed + 's'}</text>}
    </box>
  )
}
