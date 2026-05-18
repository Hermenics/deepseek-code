import { useState, useEffect } from 'react'
import pkg from '../../../package.json' with { type: 'json' }

export function DeepSeekMascot() {
  return (
    <box flexDirection="column">
      <text fg="cyan">{' ▄▄███▄▄'}</text>
      <text fg="cyan">{'▄█ ◉    ██▄'}</text>
      <text fg="cyan">{'█          ~~█'}</text>
      <text fg="cyan">{'▀▄▄█▄▄▄▄█▀'}</text>
    </box>
  )
}

export function WelcomeArt() {
  const cols = process.stdout.columns ?? 80
  const isNarrow = cols < 94

  if (isNarrow) {
    return (
      <box flexDirection="column" marginBottom={1} marginTop={1}>
        <box flexDirection="row" gap={2}>
          <DeepSeekMascot />
          <box flexDirection="column">
            <box flexDirection="row" gap={1}>
              <text fg="cyan">{'◆ DeepSeek Code'}</text>
              <text fg="#888888">{'v' + pkg.version}</text>
            </box>
            <text fg="#5599ff">Deep reasoning, hello world.</text>
            <text fg="#888888">Elite code.</text>
          </box>
        </box>
      </box>
    )
  }

  return (
    <box flexDirection="column">
      <box flexDirection="row" gap={1}>
        <text fg="cyan">{'Welcome to DeepSeek Code'}</text>
        <text fg="#888888">{'v' + pkg.version}</text>
      </box>
      <box marginTop={1} flexDirection="column">
        <text fg="#888888">{'  *          .        *             .       *          .*          .   '}</text>
        <text fg="#888888">{'       .          *         .              *               .              *'}</text>
        <text fg="#888888">{'  .       *              .        *               .       *               . '}</text>
        <text fg="#888888">{'        .       *                    .        *       .    '}</text>
        <text fg="#888888">{'  *          .        *             .       *          .   '}</text>
        <box flexDirection="row">
          <text fg="cyan">{'          ▄▄███▄▄'}</text>
          <text fg="#888888">{'    .        *       .      *        .  *       .      *        .  '}</text>
        </box>
        <box flexDirection="row">
          <text fg="cyan">{'        ▄█ ◉    ██▄'}</text>
          <text fg="#888888">{'  *          .        *              .  *       .      *        .  '}</text>
        </box>
        <box flexDirection="row">
          <text fg="cyan">{'        █          ~~█'}</text>
          <text fg="#888888">{'       *          .        *       .    *       .      *        .  '}</text>
        </box>
        <text fg="#888888">{'~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~'}</text>
        <text fg="#888888">{'~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~ '}</text>
      </box>
    </box>
  )
}

interface WelcomeScreenProps {
  children: React.ReactNode
}

export function WelcomeScreen({ children }: WelcomeScreenProps) {
  const [showChildren, setShowChildren] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setShowChildren(true), 50)
    return () => clearTimeout(t)
  }, [])

  return (
    <box flexDirection="column">
      <WelcomeArt />
      {showChildren && children}
    </box>
  )
}
