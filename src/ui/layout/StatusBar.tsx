import React, { useState, useEffect } from 'react'
import { Box, Text } from 'ink'
import figures from 'figures'
import { execa } from 'execa'
import type { Model } from '../../commands.js'
import { MODE_COLORS, MODE_LABELS, type InteractionMode } from '../interactionMode.js'

async function getGitBranch(): Promise<string> {
  try {
    const { stdout } = await execa('git', ['rev-parse', '--abbrev-ref', 'HEAD'])
    return stdout.trim()
  } catch {
    return ''
  }
}

export const StatusBar = React.memo(function StatusBar({ tokenCount, model, activeAgent, provider, contextPct = 0, interactionMode = 'chat' }: {
  tokenCount: number
  model: Model
  activeAgent: string | null
  provider?: string
  contextPct?: number
  interactionMode?: InteractionMode
}) {
  const [branch, setBranch] = useState('')

  useEffect(() => {
    getGitBranch().then(setBranch)
    const interval = setInterval(() => getGitBranch().then(setBranch), 10000)
    return () => clearInterval(interval)
  }, [])

  const parts: string[] = []
  if (tokenCount > 0) parts.push(`${tokenCount.toLocaleString()} tokens`)
  if (branch) parts.push(branch)
  if (contextPct > 0) parts.push(`ctx ${contextPct}%`)

  if (parts.length === 0 && !model) return null

  return (
    <Box flexDirection="column">
      <Box paddingX={2} gap={0}>
        {tokenCount > 0 && <Text dimColor>{figures.bullet} {tokenCount.toLocaleString()} tokens  </Text>}
        {branch && <Text dimColor>{figures.arrowRight} {branch}  </Text>}
        <Text dimColor>{figures.lozenge} {model}</Text>
        {contextPct > 0 && (
          <>
            <Text dimColor>  {figures.lineVertical} ctx </Text>
            <Text color={contextPct >= 90 ? 'red' : contextPct >= 70 ? 'yellow' : 'cyan'} dimColor={contextPct < 50}>
              {contextPct}%
            </Text>
          </>
        )}
        <Text dimColor>  {figures.lineVertical} </Text>
        <Text color={MODE_COLORS[interactionMode]}>{MODE_LABELS[interactionMode]}</Text>
      </Box>
    </Box>
  )
})
