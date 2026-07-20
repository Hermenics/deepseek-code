import { type PropsWithChildren, useCallback } from 'react'
import Box from '../../ink/components/Box.js'
import Text from '../../ink/components/Text.js'
import useInput from '../../ink/hooks/use-input.js'
import { useThemeColors } from './ThemeProvider.js'

export interface DialogProps {
  title: string
  subtitle?: string
  onConfirm: () => void
  onCancel: () => void
  confirmLabel?: string
  cancelLabel?: string
}

export function Dialog({ title, subtitle, onConfirm, onCancel, confirmLabel = 'Yes', cancelLabel = 'No', children }: PropsWithChildren<DialogProps>) {
  const colors = useThemeColors()

  useInput(useCallback((_input: string, key: { escape?: boolean; return?: boolean }) => {
    if (key.escape) onCancel()
    if (key.return) onConfirm()
  }, [onConfirm, onCancel]))

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={colors.primary} paddingLeft={1} paddingRight={1}>
      <Text color={colors.primary} bold>{title}</Text>
      {subtitle && <Text color={colors.textDim}>{subtitle}</Text>}
      <Box flexDirection="column" marginTop={1}>
        {children}
      </Box>
      <Box marginTop={1} gap={2}>
        <Text color={colors.textDim}>Enter: {confirmLabel}</Text>
        <Text color={colors.textDim}>Esc: {cancelLabel}</Text>
      </Box>
    </Box>
  )
}
