import { useState } from 'react'
import { useKeyboard } from '@opentui/react'
import type { KeyEvent } from '@opentui/core'

const CONFIRMATIONS: Record<string, string> = {
  portuguese:  'Perfeito! Agora, por favor, execute novamente o comando que você usou para me iniciar!',
  português:   'Perfeito! Agora, por favor, execute novamente o comando que você usou para me iniciar!',
  pt:          'Perfeito! Agora, por favor, execute novamente o comando que você usou para me iniciar!',
  english:     'Perfect! Now please run the command you used to start me again!',
  en:          'Perfect! Now please run the command you used to start me again!',
  spanish:     '¡Perfecto! Ahora, por favor, ejecuta nuevamente el comando que usaste para iniciarme.',
  español:     '¡Perfecto! Ahora, por favor, ejecuta nuevamente el comando que usaste para iniciarme.',
  es:          '¡Perfecto! Ahora, por favor, ejecuta nuevamente el comando que usaste para iniciarme.',
  french:      'Parfait ! Maintenant, veuillez relancer la commande que vous avez utilisée pour me démarrer.',
  français:    'Parfait ! Maintenant, veuillez relancer la commande que vous avez utilisée pour me démarrer.',
  fr:          'Parfait ! Maintenant, veuillez relancer la commande que vous avez utilisée pour me démarrer.',
  german:      'Perfekt! Bitte führe den Befehl, den du zum Starten verwendet hast, erneut aus.',
  deutsch:     'Perfekt! Bitte führe den Befehl, den du zum Starten verwendet hast, erneut aus.',
  de:          'Perfekt! Bitte führe den Befehl, den du zum Starten verwendet hast, erneut aus.',
  italian:     'Perfetto! Ora, per favore, esegui nuovamente il comando che hai usato per avviarmi.',
  italiano:    'Perfetto! Ora, per favore, esegui nuovamente il comando che hai usato per avviarmi.',
  it:          'Perfetto! Ora, per favore, esegui nuovamente il comando che hai usato per avviarmi.',
  chinese:     '完美！现在请重新运行您用来启动我的命令！',
  zh:          '完美！现在请重新运行您用来启动我的命令！',
  japanese:    '完璧です！では、起動に使ったコマンドをもう一度実行してください！',
  ja:          '完璧です！では、起動に使ったコマンドをもう一度実行してください！',
  russian:     'Отлично! Теперь, пожалуйста, запустите команду, которую вы использовали для запуска, снова!',
  русский:     'Отлично! Теперь, пожалуйста, запустите команду, которую вы использовали для запуска, снова!',
  ru:          'Отлично! Теперь, пожалуйста, запустите команду, которую вы использовали для запуска, снова!',
  arabic:      '!رائع! الآن، من فضلك، أعد تشغيل الأمر الذي استخدمته لبدء تشغيلي',
  ar:          '!رائع! الآن، من فضلك، أعد تشغيل الأمر الذي استخدمته لبدء تشغيلي',
}

function getConfirmation(lang: string): string {
  return CONFIRMATIONS[lang.toLowerCase().trim()]
    ?? 'Perfect! Now please run the command you used to start me again!'
}

interface Props {
  onDone(language: string): void
}

export function LanguageSetup({ onDone }: Props) {
  const [input, setInput] = useState('')
  const [confirmed, setConfirmed] = useState<string | null>(null)

  useKeyboard((key: KeyEvent) => {
    if (key.ctrl && key.name === 'c') process.exit(0)
    if (confirmed) return

    if (key.name === 'return') {
      const lang = input.trim()
      if (!lang) return
      setConfirmed(lang)
      onDone(lang)
      return
    }
    if (key.name === 'backspace' || key.name === 'delete') { setInput((s) => s.slice(0, -1)); return }
    if (!key.ctrl && !key.meta && key.raw && key.raw.length === 1) setInput((s) => s + key.raw)
  })

  if (confirmed) {
    return (
      <box flexDirection="column" marginTop={1} paddingLeft={2} paddingRight={2}>
        <box border borderStyle="rounded" borderColor="cyan" paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} flexDirection="column">
          <text fg="cyan">◆ deepseek</text>
          <box marginTop={1}>
            <text>{getConfirmation(confirmed)}</text>
          </box>
        </box>
      </box>
    )
  }

  return (
    <box flexDirection="column" marginTop={1} paddingLeft={2} paddingRight={2}>
      <box border borderStyle="rounded" borderColor="cyan" paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} flexDirection="column">
        <text fg="cyan">◆ deepseek</text>
        <box marginTop={1}>
          <text>{"Hello! I'm new here. Can I just know.... What language do you want me to talk with you?"}</text>
        </box>
      </box>
      <box marginTop={1}>
        <text fg="#888888">0%  </text>
        <text fg="cyan">{'> '}</text>
        <text>{input}</text>
        <text fg="cyan">█</text>
        {!input && <text fg="#888888"> write your main language</text>}
      </box>
      <box marginTop={1}>
        <text fg="#888888">Enter to confirm · Ctrl+C to exit</text>
      </box>
    </box>
  )
}
