import { useState, useEffect } from 'react'
import { execa } from 'execa'
import type { Model } from '../../commands.js'
import { MODE_COLORS, MODE_LABELS, type InteractionMode } from '../interactionMode.js'
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

export function StatusBar({ tokenCount, model, activeAgent, provider, contextPct = 0, interactionMode = 'chat' }: {
  tokenCount: number
  model: Model
  activeAgent: string | null
  provider?: string
  contextPct?: number
  interactionMode?: InteractionMode
}) {
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

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" paddingLeft={2} paddingRight={2}>
        {tokenCount > 0 && <Text color="#888888">{'• ' + tokenCount.toLocaleString() + ' tokens  '}</Text>}
        {branch && <Text color="#888888">{'→ ' + branch + '  '}</Text>}
        <Text color="#888888">{'◆ ' + model}</Text>
        {contextPct > 0 && (
          <>
            <Text color="#888888">{'  │ ctx '}</Text>
            <Text color={contextPct >= 90 ? 'red' : contextPct >= 70 ? 'yellow' : 'cyan'}>
              {contextPct + '%'}
            </Text>
          </>
        )}
        <Text color="#888888">{'  │ '}</Text>
        <Text color={MODE_COLORS[interactionMode]}>{MODE_LABELS[interactionMode]}</Text>
      </Box>
    </Box>
  )
}
