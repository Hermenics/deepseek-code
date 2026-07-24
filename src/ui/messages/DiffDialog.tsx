import { useCallback } from 'react'
import Box from '../../ink/components/Box.js'
import Text from '../../ink/components/Text.js'
import useInput from '../../ink/hooks/use-input.js'
import { Dialog } from '../design-system/index.js'
import { getThemeColors } from '../theme.js'
import type { ThemeName } from '../theme.js'

export interface DiffLine { type: 'added' | 'removed' | 'context'; text: string; lineNo: number }

export interface DiffDialogProps {
  path: string
  lines: DiffLine[]
  onClose: () => void
  theme: ThemeName
}

export function DiffDialog({ path, lines, onClose, theme }: DiffDialogProps) {
  const colors = getThemeColors(theme)
  const cols = process.stdout.columns ?? 80

  const maxLineNo = lines.reduce((max, l) => Math.max(max, l.lineNo), 0)
  const lineNoWidth = Math.max(String(maxLineNo).length, 2)
  const gutterWidth = lineNoWidth + 3
  const contentWidth = Math.max(1, cols - gutterWidth - 6)

  return (
    <Dialog
      title={path}
      onConfirm={onClose}
      onCancel={onClose}
      confirmLabel="close"
      cancelLabel="close"
    >
      <Box flexDirection="column">
        {lines.map((line, i) => {
          const isAdd = line.type === 'added'
          const isDel = line.type === 'removed'
          const sigil = isAdd ? '+' : isDel ? '-' : ' '
          const bgColor = isAdd ? colors.diffAdded : isDel ? colors.diffRemoved : undefined
          const textColor = isAdd ? colors.diffAddedWord : isDel ? colors.diffRemovedWord : colors.textDim

          const code = line.text.startsWith('+') || line.text.startsWith('-') || line.text.startsWith(' ')
            ? line.text.slice(1)
            : line.text
          const truncated = code.length > contentWidth ? code.slice(0, contentWidth - 1) + '…' : code
          const padding = ' '.repeat(Math.max(0, contentWidth - truncated.length))
          const lineNoStr = (isAdd || line.type === 'context')
            ? String(line.lineNo).padStart(lineNoWidth)
            : ' '.repeat(lineNoWidth)

          return (
            <Box key={i} flexDirection="row">
              <Text backgroundColor={bgColor} color={colors.textSubtle} dimColor={!isAdd && !isDel}>
                {' ' + lineNoStr + ' ' + sigil + ' '}
              </Text>
              <Text backgroundColor={bgColor} color={textColor}>
                {truncated + padding}
              </Text>
            </Box>
          )
        })}
      </Box>
    </Dialog>
  )
}
