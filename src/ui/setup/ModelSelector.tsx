import { useState } from 'react'
import { useKeyboard } from '@opentui/react'
import type { KeyEvent } from '@opentui/core'
import type { Model } from '../../commands.js'

interface Props {
  currentModel: Model
  models: string[]
  onSelect(model: Model): void
  onCancel(): void
}

export function ModelSelector({ currentModel, models, onSelect, onCancel }: Props) {
  const [idx, setIdx] = useState(() => {
    const i = models.indexOf(currentModel)
    return i >= 0 ? i : 0
  })

  useKeyboard((key: KeyEvent) => {
    if (models.length === 0) {
      if (key.name === 'escape') { onCancel(); return }
      return
    }
    if (key.name === 'up') { setIdx((i) => (i - 1 + models.length) % models.length); return }
    if (key.name === 'down') { setIdx((i) => (i + 1) % models.length); return }
    if (key.name === 'return') { onSelect(models[idx]!); return }
    if (key.name === 'escape') { onCancel(); return }
  })

  if (models.length === 0) {
    return (
      <box flexDirection="column" marginTop={1}>
        <text fg="#888888">/models</text>
        <box marginTop={1}>
          <text fg="yellow">No models available from this provider.</text>
        </box>
        <text fg="#888888">Esc to go back</text>
      </box>
    )
  }

  return (
    <box flexDirection="column" marginTop={1}>
      <text fg="#888888">/models</text>
      <box flexDirection="column" marginTop={1}>
        {models.map((m, i) => (
          <box key={m} flexDirection="row" gap={2}>
            <text fg={i === idx ? 'cyan' : undefined}>
              {i === idx ? '❯ ' : '  '}{m}
            </text>
            {m === currentModel && <text fg="#888888">[active]</text>}
          </box>
        ))}
      </box>
      <box marginTop={1}><text fg="#888888">{'─'.repeat(60)}</text></box>
      <text fg="#888888">↑↓ navigate · Enter select · Esc cancel</text>
    </box>
  )
}
