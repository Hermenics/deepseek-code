import { useState, useEffect } from 'react'
import { execa } from 'execa'
import type { Model } from '../../commands.js'
import { MODE_COLORS, MODE_LABELS, type InteractionMode } from '../interactionMode.js'
import { getThemeColors, DIVIDER_CHAR, PROGRESS_CHARS, STATUS_ICONS } from '../theme.js'
import type { ThemeName } from '../theme.js'
import type { StatusBarItem } from '../../settings/types.js'
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

export function StatusBar({ tokenCount, model, activeAgent: _activeAgent, provider: _provider, contextPct = 0, interactionMode = 'build', theme = 'dark', items, narrowPriority, compactBadge }: {
  tokenCount: number
  model: Model
  activeAgent: string | null
  provider?: string
  contextPct?: number
  interactionMode?: InteractionMode
  theme?: ThemeName
  items?: StatusBarItem[]
  narrowPriority?: StatusBarItem[]
  compactBadge?: { type: 'micro' | 'full'; triggeredAt: number } | null
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

  const cols = process.stdout.columns ?? 80
  const isVeryNarrow = cols < 60
  const isNarrow = cols < 80
  const divider = DIVIDER_CHAR.repeat(Math.max(0, cols - 4))
  const displayModel = isVeryNarrow ? String(model).slice(0, 15) : String(model)
  const configured = items ?? ['mode', 'model', 'tokens', 'branch', 'context']
  const prioritized = isNarrow
    ? (narrowPriority ?? ['mode', 'context', 'model', 'branch', 'tokens']).filter(item => configured.includes(item))
    : configured
  const visible = new Set(prioritized.slice(0, isVeryNarrow ? 2 : isNarrow ? 3 : configured.length))
  if (![...visible].some(item => item === 'mode' || item === 'model' || item === 'tokens' && tokenCount > 0 || item === 'branch' && branch || item === 'context' && contextPct > 0)) return null

  const showBadge = compactBadge != null && (Date.now() - compactBadge.triggeredAt) < 4000

  return (
    <Box flexDirection="column">
      <Text color={colors.textSubtle}>{divider}</Text>
      <Box flexDirection="row" paddingX={2} gap={1}>
        {visible.has('mode') && <Text color={MODE_COLORS[interactionMode]}>{MODE_LABELS[interactionMode]}</Text>}
        {visible.has('model') && <Text color={colors.primary}>{STATUS_ICONS.agent + ' ' + displayModel}</Text>}
        {visible.has('tokens') && tokenCount > 0 && (
          <>
            <Text color={colors.textDim}>{STATUS_ICONS.info + ' ' + tokenCount.toLocaleString() + ' tokens'}</Text>
          </>
        )}
        {visible.has('branch') && branch && (
          <>
            <Text color={colors.textDim}>{'⎇ ' + branch}</Text>
          </>
        )}
        {visible.has('context') && contextPct > 0 && (
          <>
            <Text color={contextPct >= 90 ? colors.error : contextPct >= 70 ? colors.warning : colors.primary}>
              {'ctx ' + contextPct + '%'}
            </Text>
            {!isNarrow && <ProgressBar percent={contextPct} width={10} theme={theme} />}
          </>
        )}
        {showBadge && (
          <Text color={colors.warning}>
            {'⚡ ' + (compactBadge!.type === 'micro' ? 'micro' : 'compact')}
          </Text>
        )}
      </Box>
    </Box>
  )
}
