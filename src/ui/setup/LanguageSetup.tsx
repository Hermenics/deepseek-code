import { useState } from 'react'
import useInput from '../../ink/hooks/use-input.js'
import type { Key } from '../../ink/events/input-event.js'
import Box from '../../ink/components/Box.js'
import Text from '../../ink/components/Text.js'

const RESTART_MESSAGE = 'Perfect! Now please run the command you used to start me again!'

interface Props {
  onDone(language: string): void
}

/** First-run prompt asking which language to converse in; after Enter it reports the choice and shows the restart message. Ctrl+C exits the process. */
export function LanguageSetup({ onDone }: Props) {
  const [input, setInput] = useState('')
  const [confirmed, setConfirmed] = useState<string | null>(null)

  useInput((input: string, key: Key) => {
    if (key.ctrl && input === 'c') process.exit(0)
    if (confirmed) return

    if (key.return) {
      const lang = input.trim()
      if (!lang) return
      setConfirmed(lang)
      onDone(lang)
      return
    }
    if (key.backspace || key.delete) { setInput((s) => s.slice(0, -1)); return }
    if (!key.ctrl && !key.meta && input && input.length >= 1) setInput((s) => s + input)
  })

  if (confirmed) {
    return (
      <Box flexDirection="column" marginTop={1} paddingLeft={2} paddingRight={2}>
        <Box border borderStyle="rounded" borderColor="cyan" paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} flexDirection="column">
          <Text color="cyan">◆ deepseek</Text>
          <Box marginTop={1}>
            <Text>{RESTART_MESSAGE}</Text>
          </Box>
        </Box>
      </Box>
    )
  }

  return (
    <Box flexDirection="column" marginTop={1} paddingLeft={2} paddingRight={2}>
      <Box border borderStyle="rounded" borderColor="cyan" paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} flexDirection="column">
        <Text color="cyan">◆ deepseek</Text>
        <Box marginTop={1}>
          <Text>{"Hello! I'm new here. Can I just know.... What language do you want me to talk with you?"}</Text>
        </Box>
      </Box>
      <Box marginTop={1}>
        <Text color="#888888">0%  </Text>
        <Text color="cyan">{'> '}</Text>
        <Text>{input}</Text>
        <Text color="cyan">█</Text>
        {!input && <Text color="#888888"> write your main language</Text>}
      </Box>
      <Box marginTop={1}>
        <Text color="#888888">Enter to confirm · Ctrl+C to exit</Text>
      </Box>
    </Box>
  )
}
