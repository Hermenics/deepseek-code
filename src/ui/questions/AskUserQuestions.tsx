import { useEffect, useMemo, useRef, useState } from 'react'
import useInput from '../../ink/hooks/use-input.js'
import type { Key } from '../../ink/events/input-event.js'
import Box from '../../ink/components/Box.js'
import Text from '../../ink/components/Text.js'
import type { AskUserAnswers, AskUserQuestion, AskUserQuestionOption } from '../../tools/AskUserQuestions/types.js'

interface Props {
  questions: AskUserQuestion[]
  onSubmit(answers: AskUserAnswers): void
  onCancel(): void
}

function optionsFor(question: AskUserQuestion): AskUserQuestionOption[] {
  if (question.type === 'yesno') {
    return [
      { label: 'Yes', description: 'Proceed with this choice.' },
      { label: 'No', description: 'Do not proceed with this choice.' },
    ]
  }
  return question.options ?? []
}

function rule() {
  return '─'.repeat(Math.max(20, Math.min(process.stdout.columns ?? 80, 160)))
}

/** Preserves multi-select value boundaries within the string-only answer contract. */
function serializeMultiSelect(values: string[]): string {
  return JSON.stringify(values)
}

export function AskUserQuestionsPrompt({ questions, onSubmit, onCancel }: Props) {
  const [index, setIndex] = useState(0)
  const [answers, setAnswers] = useState<AskUserAnswers>({})
  const [selected, setSelected] = useState<Record<number, string[]>>({})
  const [custom, setCustom] = useState<Record<number, string>>({})
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [text, setText] = useState('')
  const [editing, setEditing] = useState(false)
  const submitted = useRef(false)
  const question = questions[index]
  const options = useMemo(() => question ? optionsFor(question) : [], [question])
  const hasCustom = question?.type !== 'text' && question?.type !== 'yesno'
  const totalOptions = options.length + (hasCustom ? 1 : 0)
  const questionType = question?.type ?? 'choice'
  const isText = questionType === 'text'
  const isMulti = questionType === 'choice' && question?.multiSelect === true

  useEffect(() => {
    setText(custom[index] ?? '')
    setSelectedIndex(0)
    setEditing(isText)
  }, [index, custom, isText])

  const finish = (answers: AskUserAnswers) => {
    if (submitted.current) return
    submitted.current = true
    onSubmit(answers)
  }

  const advance = (value?: string) => {
    const nextAnswers = { ...answers }
    if (value?.trim()) nextAnswers[String(index)] = value.trim()
    else delete nextAnswers[String(index)]
    if (index >= questions.length - 1) finish(nextAnswers)
    else {
      setAnswers(nextAnswers)
      setIndex((current) => current + 1)
      setEditing(false)
    }
  }

  const saveCustom = () => {
    const value = text.trim()
    setCustom((current) => ({ ...current, [index]: value }))
    if (isMulti) {
      const current = selected[index] ?? []
      const previous = custom[index]
      const next = previous ? current.filter((item) => item !== previous) : [...current]
      if (value && !next.includes(value)) next.push(value)
      setSelected((all) => ({ ...all, [index]: next }))
      setEditing(false)
      return
    }
    advance(value)
  }

  useInput((input: string, key: Key) => {
    if (key.escape || (key.ctrl && input === 'c')) { onCancel(); return }
    if (!question) return

    if (isText || editing) {
      if (key.return) { saveCustom(); return }
      if (key.backspace || key.delete) { setText((value) => value.slice(0, -1)); return }
      if (!key.ctrl && !key.meta && input) setText((value) => value + input)
      return
    }

    const numericIndex = /^[1-9]$/.test(input) ? Number(input) - 1 : -1
    if (numericIndex >= 0 && numericIndex < totalOptions) {
      setSelectedIndex(numericIndex)
      if (numericIndex >= options.length) {
        setText(custom[index] ?? '')
        setEditing(true)
        return
      }
      const label = options[numericIndex]!.label
      if (!isMulti) { advance(label); return }
      const current = selected[index] ?? []
      const next = current.includes(label) ? current.filter((item) => item !== label) : [...current, label]
      setSelected((all) => ({ ...all, [index]: next }))
      return
    }

    if (key.upArrow || input === 'k') { setSelectedIndex((current) => (current - 1 + totalOptions) % totalOptions); return }
    if (key.downArrow || input === 'j') { setSelectedIndex((current) => (current + 1) % totalOptions); return }
    if (key.return || input === ' ') {
      if (selectedIndex >= options.length) {
        if (isMulti && custom[index] && (selected[index]?.length ?? 0) > 0 && key.return) {
          advance(serializeMultiSelect(selected[index]!))
          return
        }
        setText(custom[index] ?? '')
        setEditing(true)
        return
      }
      const label = options[selectedIndex]!.label
      const current = selected[index] ?? []
      if (isMulti) {
        if (input === ' ') {
          const next = current.includes(label) ? current.filter((item) => item !== label) : [...current, label]
          setSelected((all) => ({ ...all, [index]: next }))
        } else if (key.return) {
          advance(serializeMultiSelect(current))
        }
        return
      }
      advance(label)
    }
  })

  if (!question) return null
  const currentSelected = selected[index] ?? []
  const activeHeader = question.header || 'Question'
  const numberHint = totalOptions > 0 && totalOptions <= 9
    ? ` · 1-${totalOptions} ${isMulti ? 'toggle' : 'select'}`
    : ''

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color="#444444">{rule()}</Text>
      <Box flexDirection="row" gap={1} marginTop={1}>
        <Text color="cyan">☐</Text>
        <Text bold>{activeHeader}</Text>
        {questions.length > 1 && <Text color="#888888">{index + 1}/{questions.length}</Text>}
      </Box>
      <Box marginTop={1}>
        <Text>{question.question}</Text>
      </Box>
      {isText || editing ? (
        <Box flexDirection="row" gap={1} marginTop={1}>
          <Text color="cyan">❯</Text>
          {text ? (
            <Text>{text}<Text color="cyan">{'█'}</Text></Text>
          ) : (
            <Text color="#888888">{question.placeholder ?? 'Type your answer'}</Text>
          )}
        </Box>
      ) : (
        <Box flexDirection="column" marginTop={1}>
          {options.map((option, optionIndex) => {
            const active = optionIndex === selectedIndex
            const checked = currentSelected.includes(option.label)
            return (
              <Box key={option.label} flexDirection="column">
                <Box flexDirection="row">
                  <Text color={active ? 'cyan' : undefined}>{active ? '❯' : ' '}</Text>
                  <Text> {optionIndex + 1}. </Text>
                  <Text bold={active}>{isMulti ? `[${checked ? 'x' : ' '}] ` : ''}{option.label}</Text>
                </Box>
                <Box marginLeft={6}>
                  <Text color="#888888">{option.description}</Text>
                </Box>
              </Box>
            )
          })}
          {hasCustom && (
            <Box flexDirection="column">
              <Box flexDirection="row">
                <Text color={selectedIndex === options.length ? 'cyan' : undefined}>{selectedIndex === options.length ? '❯' : ' '}</Text>
                <Text> {options.length + 1}. </Text>
                <Text bold={selectedIndex === options.length}>Other</Text>
              </Box>
              <Box marginLeft={6}>
                <Text color="#888888">Type something.</Text>
              </Box>
            </Box>
          )}
        </Box>
      )}
      <Text color="#444444">{rule()}</Text>
      <Box marginTop={1}>
        <Text color="#888888">{isText || editing ? 'Enter to save · Esc to cancel' : `${isMulti ? 'Enter to select · ↑↓ to navigate · Space to toggle' : 'Enter to select · ↑↓ to navigate'}${numberHint} · Esc to cancel`}</Text>
      </Box>
    </Box>
  )
}
