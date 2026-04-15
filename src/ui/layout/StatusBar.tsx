import React, { useState, useEffect } from 'react'
import { Box, Text } from 'ink'
import { execa } from 'execa'
import { homedir } from 'os'
import type { Model } from '../../commands.js'

async function getGitBranch(): Promise<string> {
  try {
    const { stdout } = await execa('git', ['rev-parse', '--abbrev-ref', 'HEAD'])
    return stdout.trim()
  } catch {
    return ''
  }
}

function shortPath(p: string): string {
  const home = homedir()
  return p.startsWith(home) ? p.replace(home, '~') : p
}

export const StatusBar = React.memo(function StatusBar({ tokenCount, model, activeAgent, provider }: {
  tokenCount: number
  model: Model
  activeAgent: string | null
  provider?: string
}) {
  const [branch, setBranch] = useState('')
  const [cols, setCols] = useState(process.stdout.columns ?? 80)

  useEffect(() => {
    getGitBranch().then(setBranch)
    // Refresh branch every 10s in case user switches branches
    const interval = setInterval(() => getGitBranch().then(setBranch), 10000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    const onResize = () => setCols(process.stdout.columns ?? 80)
    process.stdout.on('resize', onResize)
    return () => { process.stdout.off('resize', onResize) }
  }, [])

  const providerLabel = provider && provider !== 'deepseek' ? provider : null

  return (
    <Box flexDirection="column">
      <Text dimColor>{'─'.repeat(cols)}</Text>
      <Box paddingX={1} gap={0}>
        <Text color="cyan" bold>◆ {activeAgent ?? 'deepseek'}</Text>
        <Text dimColor>  ·  </Text>
        <Text color="cyan">{model}</Text>
        {providerLabel ? (
          <>
            <Text dimColor>  ·  </Text>
            <Text color="yellow">{providerLabel}</Text>
          </>
        ) : null}
        <Text dimColor>  ·  </Text>
        <Text color={tokenCount > 0 ? 'green' : undefined} dimColor={tokenCount === 0}>
          {tokenCount.toLocaleString()} tokens
        </Text>
        <Text dimColor>  ·  </Text>
        <Text dimColor>{shortPath(process.cwd())}</Text>
        {branch ? <Text dimColor>  ({branch})</Text> : null}
      </Box>
    </Box>
  )
})
