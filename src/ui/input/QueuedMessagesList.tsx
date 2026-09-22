import Box from '../../ink/components/Box.js'
import Text from '../../ink/components/Text.js'
import { useThemeColors } from '../design-system/ThemeProvider.js'
export const MAX_MSG_LEN = 60

/** Cuts a queued message to MAX_MSG_LEN characters, adding an ellipsis when it was shortened. */
export function truncateMessage(msg: string): string {
  if (msg.length <= MAX_MSG_LEN) return msg
  return msg.slice(0, MAX_MSG_LEN) + '…'
}

/** Normalizes queued messages (plain strings or `{ text }` objects) into truncated display items. */
export function buildQueueItems(messages: Array<string | { text: string }>): { text: string }[] {
  return messages.map((msg) => ({ text: truncateMessage(typeof msg === 'string' ? msg : msg.text) }))
}

interface Props {
  messages: Array<string | { text: string }>
}

/** Renders the messages queued while the agent is busy, one dimmed line each; renders nothing when the queue is empty. */
export function QueuedMessagesList({ messages }: Props) {
  const colors = useThemeColors()
  if (messages.length === 0) return null

  const items = buildQueueItems(messages)

  return (
    <Box flexDirection="column" paddingLeft={1}>
      {items.map((item, i) => (
        <Box key={i} flexDirection="row" gap={1}>
          <Text color={colors.h2}>{'⏎'}</Text>
          <Text color={colors.textDim}>{item.text}</Text>
        </Box>
      ))}
    </Box>
  )
}
