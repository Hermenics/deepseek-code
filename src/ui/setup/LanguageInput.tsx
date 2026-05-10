import { useState } from 'react'
import { useKeyboard } from '@opentui/react'
import type { KeyEvent } from '@opentui/core'

interface Props {
  currentLanguage: string | null
  onDone(language: string): void
  onCancel(): void
}

export function LanguageInput({ currentLanguage, onDone, onCancel }: Props) {
  const [input, setInput] = useState('')

  useKeyboard((key: KeyEvent) => {
    if (key.name === 'escape') { onCancel(); return }
    if (key.name === 'return') {
      const lang = input.trim()
      if (lang) onDone(lang)
      return
    }
    if (key.name === 'backspace' || key.name === 'delete') { setInput((s) => s.slice(0, -1)); return }
    if (!key.ctrl && !key.meta && key.raw && key.raw.length === 1) setInput((s) => s + key.raw)
  })

  return (
    <box flexDirection="column" marginTop={1}>
      <text fg="#888888">/language</text>
      <box marginTop={1} flexDirection="row" gap={1}>
        <text fg="cyan">{'>'}</text>
        <text>{input}</text>
        <text fg="cyan">█</text>
        {!input && <text fg="#888888">type your preferred language (e.g. Portuguese, English…)</text>}
      </box>
      {currentLanguage && (
        <box marginTop={0}>
          <text fg="#888888">  current: {currentLanguage}</text>
        </box>
      )}
      <box marginTop={1}><text fg="#888888">{'─'.repeat(60)}</text></box>
      <text fg="#888888">Enter confirm · Esc cancel</text>
    </box>
  )
}
