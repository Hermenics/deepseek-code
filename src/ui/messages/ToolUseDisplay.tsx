import { useState, useEffect } from 'react'
import type { ToolStatus } from '../App.js'
import { previewToolCallArgs, summarizeToolPayload, TOOL_DISPLAY, TOOL_STYLE } from './toolDisplay.js'
import { getThemeColors, STATUS_ICONS } from '../theme.js'
import type { ThemeName } from '../theme.js'
import { useClock } from '../clock.js'
import Box from '../../ink/components/Box.js'
import Text from '../../ink/components/Text.js'

const SPINNER_FRAMES = ['◌', '○', '◎', '◉', '◎', '○']

/** One-line tool call status: spinner and elapsed seconds while running, then a success/error dot with a summarized result; subagent calls show the first line of their task. */
export function ToolUseDisplay({ tool, theme = 'dark' }: { tool: ToolStatus; theme?: ThemeName }) {
  const colors = getThemeColors(theme)
  const display = TOOL_DISPLAY[tool.name] ?? tool.name
  const rawArg = tool.done ? (tool.result ?? '') : (tool.args ?? '')

  // For subagent tool, extract the 'task' field from the JSON args instead of showing raw JSON
  let arg: string
  if (tool.name === 'subagent' && !tool.done && tool.args) {
    try {
      const parsed = JSON.parse(tool.args) as Record<string, unknown>
      const task = typeof parsed.task === 'string' ? parsed.task : rawArg
      // Take first non-empty line, strip markdown headers and extra whitespace
      const firstLine = task
        .split('\n')
        .map(l => l.replace(/^#+\s*/, '').trim())
        .find(l => l.length > 0) ?? task
      arg = firstLine.length > 60 ? firstLine.slice(0, 60) + '…' : firstLine
    } catch {
      arg = rawArg.length > 60 ? rawArg.slice(0, 60) + '…' : rawArg
    }
  } else {
    arg = rawArg.length > 60 ? rawArg.slice(0, 60) + '…' : rawArg
    if (tool.done && tool.result) {
      arg = summarizeToolPayload(tool.name, tool.result)
    } else if (!tool.done && tool.args) {
      try {
        const parsed = JSON.parse(tool.args) as Record<string, unknown>
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          arg = previewToolCallArgs(tool.name, parsed)
        }
      } catch {
        // The active preview may already be a human-readable string.
      }
    }
  }

  const tick = useClock()
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    setElapsed(0)
    if (tool.done) return
    const t = setInterval(() => setElapsed((s) => s + 1), 1000)
    return () => clearInterval(t)
  }, [tool.name, tool.done])

  const style = TOOL_STYLE[display] || { icon: '▸', color: colors.textDim }

  const failed = 'error' in tool && tool.error
  // Right-aligned status: sonar pulse while running, then ✓/✗
  const status = tool.done
    ? (failed ? STATUS_ICONS.error : STATUS_ICONS.success)
    : SPINNER_FRAMES[tick % SPINNER_FRAMES.length]
  const statusColor = tool.done ? (failed ? colors.error : colors.success) : colors.primary

  return (
    <Box flexDirection="row" paddingLeft={2} paddingRight={1} justifyContent="space-between">
      <Box flexDirection="row" gap={1} flexShrink={1}>
        <Text color={colors.primary}>{STATUS_ICONS.tool}</Text>
        <Text color={style.color}>{display}</Text>
        {arg ? <Text color={colors.textSubtle}>{arg}</Text> : null}
      </Box>
      <Box flexDirection="row" gap={1} flexShrink={0}>
        {!tool.done && elapsed > 0 && <Text color={colors.textDim}>{elapsed + 's'}</Text>}
        <Text color={statusColor}>{status}</Text>
      </Box>
    </Box>
  )
}
