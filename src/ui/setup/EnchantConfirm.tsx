import useInput from '../../ink/hooks/use-input.js'
import Box from '../../ink/components/Box.js'
import Text from '../../ink/components/Text.js'

interface Props {
  currentlyEnabled: boolean
  onConfirm(enabled: boolean): void
}

export function EnchantConfirm({ currentlyEnabled, onConfirm }: Props) {
  useInput((input: string) => {
    const lower = input.toLowerCase()
    if (lower === 'y') {
      onConfirm(true)
    } else if (lower === 'n' || input === '\r') {
      onConfirm(false)
    }
  })

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box flexDirection="row" gap={1}>
        <Text color="cyan">{'>'}</Text>
        <Text>Prompt enchantment (currently {currentlyEnabled ? 'enabled' : 'disabled'}): enable? [y/N] </Text>
        <Text color="cyan">_</Text>
      </Box>
      <Box marginTop={1}><Text color="#888888">y = enable | n/Enter = disable | </Text></Box>
    </Box>
  )
}
