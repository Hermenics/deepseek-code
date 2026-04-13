import React, { useState, useEffect } from 'react'
import { Box, Text } from 'ink'
import { execaCommand } from 'execa'
import { homedir } from 'os'
import type { Model } from '../../commands.js'

async function getGitBranch(): Promise<string> {
  try {
    const { stdout } = await execaCommand('git rev-parse --abbrev-ref HEAD', { shell: true })
    return stdout.trim()
  } catch {
    return ''
  }
}

function shortPath(p: string): string {
  const home = homedir()
  return p.startsWith(home) ? p.replace(home, '~') : p
}

export function StatusBar({ tokenCount, model, activeAgent }: { tokenCount: number; model: Model; activeAgent: string | null }) {
  const [branch, setBranch] = useState('')

  useEffect(() => {
    getGitBranch().then(setBranch)
  }, [])

  const left = [
    activeAgent ? <Text key="agent" color="cyan">{activeAgent}</Text> : <Text key="ds" color="cyan">deepseek</Text>,
    <Text key="s1" dimColor> · </Text>,
    <Text key="model" dimColor>{model}</Text>,
    tokenCount > 0 ? <Text key="s2" dimColor> · </Text> : null,
    tokenCount > 0 ? <Text key="tokens" color="green">{tokenCount.toLocaleString()} tokens</Text> : null,
  ]

  const right = [
    <Text key="path" dimColor>{shortPath(process.cwd())}</Text>,
    branch ? <Text key="s3" dimColor> · </Text> : null,
    branch ? <Text key="branch" dimColor>({branch})</Text> : null,
  ]

  return (
    <Box flexDirection="column">
      <Text dimColor>{'─'.repeat(80)}</Text>
      <Box justifyContent="space-between">
        <Box>{left}</Box>
        <Box>{right}</Box>
      </Box>
    </Box>
  )
}
