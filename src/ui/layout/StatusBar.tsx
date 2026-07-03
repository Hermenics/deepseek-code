import { useState, useEffect } from 'react'
import { execa } from 'execa'
import type { Model } from '../../commands.js'
import { MODE_COLORS, MODE_LABELS, type InteractionMode } from '../interactionMode.js'
import { getThemeColors, DIVIDER_CHAR, PROGRESS_CHARS, STATUS_ICONS } from '../theme.js'
import type { ThemeName } from '../theme.js'
import Box from '../../ink/components/Box.js'
import Text from '../../ink/components/Text.js'

async function getGitBranch(): Promise<string> {
  try {
    const { stdout } = await execa('git', ['rev-parse', '--abbrev-ref', 'HEAD'])
    return stdout.trim()
  } catch {
    return ''
  }
}

function ProgressBar({ percent, width = 20, theme = 'dark' }: { percent: number; width?: number; theme?: ThemeName }) {
  const colors = getThemeColors(theme)
  const filled = Math.floor((percent / 100) * width)
  const remainder = ((percent / 100) * width) - filled
  const partialIdx = Math.floor(remainder * 8)
  const partial = partialIdx > 0 && partialIdx < 8 ? PROGRESS_CHARS[partialIdx] : ''
  const empty = width - filled - (partial ? 1 : 0)

  const barColor = percent >= 90 ? colors.error : percent >= 70 ? colors.warning : colors.primary

  return (
    <Text color={barColor}>
      {'█'.repeat(filled)}{partial}{' '.repeat(Math.max(0, empty))}
    </Text>
  )
}

export function StatusBar({ tokenCount, model, activeAgent: _activeAgent, provider: _provider, contextPct = 0, interactionMode = 'build', theme = 'dark' }: {
  tokenCount: number
  model: Model
  activeAgent: string | null
  provider?: string
  contextPct?: number
  interactionMode?: InteractionMode
  theme?: ThemeName
}) {
  const colors = getThemeColors(theme)
  const [branch, setBranch] = useState('')

  useEffect(() => {
    let cancelled = false
    getGitBranch().then((b) => { if (!cancelled) setBranch(b) })
    const interval = setInterval(() => {
      getGitBranch().then((b) => { if (!cancelled) setBranch(b) })
    }, 30_000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  if (tokenCount === 0 && !branch) return null

  const cols = process.stdout.columns ?? 80
  const isVeryNarrow = cols < 60
  const isNarrow = cols < 80
  const divider = DIVIDER_CHAR.repeat(Math.max(0, cols - 4))
  const displayModel = isVeryNarrow ? String(model).slice(0, 15) : String(model)

  return (
    <Box flexDirection="column">
      <Text color={colors.textSubtle}>{divider}</Text>
      <Box flexDirection="row" paddingX={2} gap={1}>
        <Text color={MODE_COLORS[interactionMode]}>{MODE_LABELS[interactionMode]}</Text>
        <Text color={colors.textSubtle}>{'·'}</Text>
        <Text color={colors.primary}>{STATUS_ICONS.agent + ' ' + displayModel}</Text>
        {!isVeryNarrow && tokenCount > 0 && (
          <>
            <Text color={colors.textSubtle}>{'·'}</Text>
            <Text color={colors.textDim}>{STATUS_ICONS.info + ' ' + tokenCount.toLocaleString() + ' tokens'}</Text>
          </>
        )}
        {!isVeryNarrow && branch && (
          <>
            <Text color={colors.textSubtle}>{'·'}</Text>
            <Text color={colors.textDim}>{'⎇ ' + branch}</Text>
          </>
        )}
        {!isNarrow && contextPct > 0 && (
          <>
            <Text color={colors.textSubtle}>{'·'}</Text>
            <Text color={contextPct >= 90 ? colors.error : contextPct >= 70 ? colors.warning : colors.primary}>
              {'ctx ' + contextPct + '%'}
            </Text>
            <ProgressBar percent={contextPct} width={10} theme={theme} />
          </>
        )}
      </Box>
    </Box>
  )
}
