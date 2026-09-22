import { useState } from 'react'
import useInput from '../../ink/hooks/use-input.js'
import type { Key } from '../../ink/events/input-event.js'
import { MarkdownText } from '../messages/MarkdownText.js'
import ScrollBox from '../../ink/components/ScrollBox.js'
import Box from '../../ink/components/Box.js'
import Text from '../../ink/components/Text.js'
import { getThemeColors, type ThemeName } from '../theme.js'

export type PlanApprovalResult =
  | { approved: true }
  | { approved: false; aborted: true }
  | { approved: false; aborted?: false; feedback: string }

const SELECT_OPTIONS = [
  { key: 'y', label: 'Yes, accept this plan' },
  { key: 'n', label: 'No, provide feedback' },
]

interface Props {
  planContent: string
  planSummary?: string
  theme: ThemeName
  onDecide: (result: PlanApprovalResult) => void
}

/** Shows a submitted plan in a scrollable box and asks the user to accept it (y) or reject it with typed feedback (n); Esc or Ctrl+C in the selector aborts. */
export function PlanApprovalPrompt({ planContent, planSummary, theme, onDecide }: Props) {
  const colors = getThemeColors(theme)
  const [phase, setPhase] = useState<'select' | 'feedback'>('select')
  const [selected, setSelected] = useState(0)
  const [feedbackText, setFeedbackText] = useState('')

  const scrollHeight = Math.min(20, Math.max(6, (process.stdout.rows ?? 24) - 10))

  useInput((input: string, key: Key) => {
    if (phase === 'select') {
      if (key.ctrl && input === 'c') {
        onDecide({ approved: false, aborted: true })
        return
      }
      if (input === 'y') { onDecide({ approved: true }); return }
      if (input === 'n') { setPhase('feedback'); return }
      if (key.upArrow) { setSelected((i) => (i - 1 + SELECT_OPTIONS.length) % SELECT_OPTIONS.length); return }
      if (key.downArrow) { setSelected((i) => (i + 1) % SELECT_OPTIONS.length); return }
      if (key.return) {
        if (selected === 0) { onDecide({ approved: true }); return }
        else { setPhase('feedback'); return }
      }
      if (key.escape) { onDecide({ approved: false, aborted: true }); return }
    }

    if (phase === 'feedback') {
      if (key.escape) { setPhase('select'); return }
      if (key.return) {
        const trimmed = feedbackText.trim()
        if (trimmed) onDecide({ approved: false, feedback: trimmed })
        return
      }
      if (key.backspace || key.delete) {
        setFeedbackText((t) => t.slice(0, -1))
        return
      }
      if (input && !key.ctrl && !key.meta) {
        setFeedbackText((t) => t + input)
      }
    }
  })

  return (
    <Box flexDirection="column" marginTop={1} marginBottom={1}>
      {planSummary && (
        <Box marginBottom={1} marginLeft={1}>
          <Text color={colors.primary} bold>{planSummary}</Text>
        </Box>
      )}

      <Box border borderStyle="rounded" borderColor={colors.primary} paddingLeft={2} paddingRight={2} flexDirection="column">
        <Text color={colors.primary}>{'◆ Plan'}</Text>
        <Box marginTop={1}>
          <ScrollBox height={scrollHeight} flexDirection="column" width="100%">
            <MarkdownText content={planContent} theme={theme} />
          </ScrollBox>
        </Box>
      </Box>

      {phase === 'select' && (
        <>
          <Box flexDirection="column" marginTop={1} marginLeft={2}>
            {SELECT_OPTIONS.map((opt, i) => (
              <Box key={opt.key} flexDirection="row" gap={2}>
                <Text color={i === selected ? colors.primary : colors.text}>
                  {i === selected ? '❯' : ' '} [{opt.key}]
                </Text>
                <Text color={i === selected ? colors.primary : colors.textDim}>
                  {opt.label}
                </Text>
              </Box>
            ))}
          </Box>
          <Box marginLeft={2}>
            <Text color={colors.textDim}>{'  ↑↓ navigate  ·  Enter confirm  ·  y/n shortcuts  ·  Ctrl+C abort'}</Text>
          </Box>
        </>
      )}

      {phase === 'feedback' && (
        <>
          <Box
            border
            borderStyle="rounded"
            borderColor={colors.warning}
            paddingLeft={2}
            paddingRight={2}
            marginTop={1}
            flexDirection="column"
          >
            <Text color={colors.warning}>{'✎ Feedback (what should change?)'}</Text>
            <Box marginTop={1}>
              <Text>{feedbackText}<Text color={colors.primary}>{'█'}</Text></Text>
            </Box>
          </Box>
          <Box marginLeft={2}>
            <Text color={colors.textDim}>{'  Enter send  ·  Esc back'}</Text>
          </Box>
        </>
      )}
    </Box>
  )
}
