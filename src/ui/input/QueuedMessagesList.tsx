import Box from '../../ink/components/Box.js'
import Text from '../../ink/components/Text.js'
export const MAX_MSG_LEN = 60

export function truncateMessage(msg: string): string {
  if (msg.length <= MAX_MSG_LEN) return msg
  return msg.slice(0, MAX_MSG_LEN) + '…'
}

export function buildQueueItems(messages: string[]): { text: string }[] {
  return messages.map((msg) => ({ text: truncateMessage(msg) }))
}

interface Props {
  messages: string[]
}

export function QueuedMessagesList({ messages }: Props) {
  if (messages.length === 0) return null

  const items = buildQueueItems(messages)

  return (
    <Box flexDirection="column" paddingLeft={1}>
      {items.map((item, i) => (
        <Box key={i} flexDirection="row" gap={1}>
          <Text color="cyan">{'⏎'}</Text>
          <Text color="#888888">{item.text}</Text>
        </Box>
      ))}
    </Box>
  )
}
