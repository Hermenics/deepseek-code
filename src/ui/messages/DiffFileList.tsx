import { getThemeColors } from '../theme.js'
import type { ThemeName } from '../theme.js'
import Box from '../../ink/components/Box.js'
import Text from '../../ink/components/Text.js'

export interface DiffFileSummary {
  path: string
  added: number
  removed: number
}

interface Props {
  files: DiffFileSummary[]
  theme: ThemeName
}

export function DiffFileList({ files, theme }: Props) {
  const colors = getThemeColors(theme)
  const cols = process.stdout.columns ?? 80

  return (
    <Box flexDirection="column">
      {files.map((file, i) => {
        const stats = `+${file.added} -${file.removed}`
        const statsWidth = stats.length + 3 // padding
        const maxPathWidth = Math.max(1, cols - statsWidth - 4)
        const path = file.path.length > maxPathWidth
          ? (maxPathWidth <= 1 ? '…' : '…' + file.path.slice(-(maxPathWidth - 1)))
          : file.path

        return (
          <Box key={i} flexDirection="row" gap={1}>
            <Text color={colors.diffAddedWord}>{'+' + file.added}</Text>
            <Text color={colors.diffRemovedWord}>{'-' + file.removed}</Text>
            <Text color={colors.textDim}>{path}</Text>
          </Box>
        )
      })}
    </Box>
  )
}
