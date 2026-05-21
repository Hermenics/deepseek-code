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
    <box flexDirection="column">
      {visible.map((cmd, vi) => {
        const i = start + vi
        const isSelected = i === selectedIdx
        const desc = descriptions[cmd] ?? ''
        const truncDesc = desc.length > descMaxLen ? desc.slice(0, descMaxLen - 1) + '…' : desc
        return (
          <box key={cmd} flexDirection="row">
            <text fg="#888888">{'│ '}</text>
            <text fg={isSelected ? 'cyan' : undefined}>{cmd.padEnd(CMD_WIDTH)}</text>
            <text fg={isSelected ? 'cyan' : '#888888'}>{truncDesc}</text>
          </box>
        )
      })}
    </box>
  )
}
