import Box from '../../../ink/components/Box.js'
import Text from '../../../ink/components/Text.js'
interface CommandDropdownProps {
  matches: string[]
  selectedIdx: number
  columns: number
  descriptions?: Record<string, string>
}

export function CommandDropdown({ matches, selectedIdx, columns, descriptions = {} }: CommandDropdownProps) {
  const MAX_VISIBLE = 6
  const total = matches.length
  const CMD_WIDTH = 22
  const descMaxLen = Math.max(10, columns - CMD_WIDTH - 4)

  const half = Math.floor(MAX_VISIBLE / 2)
  let start = Math.max(0, selectedIdx - half)
  const end = Math.min(total, start + MAX_VISIBLE)
  if (end - start < MAX_VISIBLE) start = Math.max(0, end - MAX_VISIBLE)
  const visible = matches.slice(start, end)

  return (
    <Box flexDirection="column">
      {visible.map((cmd, vi) => {
        const i = start + vi
        const isSelected = i === selectedIdx
        const desc = descriptions[cmd] ?? ''
        const truncDesc = desc.length > descMaxLen ? desc.slice(0, descMaxLen - 1) + '…' : desc
        return (
          <Box key={cmd} flexDirection="row">
            <Text color="#888888">{'│ '}</Text>
            <Text color={isSelected ? 'cyan' : undefined}>{cmd.padEnd(CMD_WIDTH)}</Text>
            <Text color={isSelected ? 'cyan' : '#888888'}>{truncDesc}</Text>
          </Box>
        )
      })}
    </Box>
  )
}
