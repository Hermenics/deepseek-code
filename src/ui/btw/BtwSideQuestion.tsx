import { useCallback } from 'react'
import useInput from '../../ink/hooks/use-input.js'
import Box from '../../ink/components/Box.js'
import Text from '../../ink/components/Text.js'
import { MarkdownText } from '../messages/MarkdownText.js'
import type { ThemeName } from '../theme.js'
import { getThemeColors } from '../theme.js'

export interface BtwState {
  question: string
  response?: string
  error?: string
}

export function BtwSideQuestion({ btw, theme, onDismiss }: { btw: BtwState; theme: ThemeName; onDismiss: () => void }) {
  const colors = getThemeColors(theme)

  useInput(useCallback((input: string, key: { escape?: boolean; return?: boolean; ctrl?: boolean }) => {
    if (key.escape || key.return || input === ' ' || (key.ctrl && (input === 'c' || input === 'd'))) onDismiss()
  }, [onDismiss]))

  return (
    <Box flexDirection="column" marginTop={1} paddingLeft={2}>
      <Box gap={1}>
        <Text color={colors.warning} bold>/btw</Text>
        <Text color={colors.textDim}>{btw.question}</Text>
      </Box>
      <Box marginTop={1} marginLeft={2} flexDirection="column">
        {btw.error ? <Text color={colors.error}>{btw.error}</Text>
          : btw.response ? <MarkdownText content={btw.response} theme={theme} />
            : <Text color={colors.warning}>Answering...</Text>}
      </Box>
      <Text color={colors.textDim}>{'Space, Enter, or Esc to dismiss'}</Text>
    </Box>
  )
}
