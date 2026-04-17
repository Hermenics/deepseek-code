import React, { useState } from 'react'
import { Box, Text, useInput } from 'ink'

// Confirmation messages in each supported language
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

  useInput((char, key) => {
    if (key.ctrl && char === 'c') process.exit(0)
    if (confirmed) return

    if (key.return) {
      const lang = input.trim()
      if (!lang) return
      setConfirmed(lang)
      onDone(lang)
      return
    }
    if (key.backspace || key.delete) { setInput((s) => s.slice(0, -1)); return }
    if (!key.ctrl && !key.meta && char) setInput((s) => s + char)
  })

  if (confirmed) {
    return (
      <Box flexDirection="column" marginY={1} paddingX={2}>
        <Box borderStyle="round" borderColor="cyan" paddingX={2} paddingY={1} flexDirection="column">
          <Text color="cyan" bold>◆ deepseek</Text>
          <Box marginTop={1}>
            <Text>{getConfirmation(confirmed)}</Text>
          </Box>
        </Box>
      </Box>
    )
  }

  return (
    <Box flexDirection="column" marginY={1} paddingX={2}>
      <Box borderStyle="round" borderColor="cyan" paddingX={2} paddingY={1} flexDirection="column">
        <Text color="cyan" bold>◆ deepseek</Text>
        <Box marginTop={1}>
          <Text>{"Hello! I'm new here. Can I just know.... What language do you want me to talk with you?"}</Text>
        </Box>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>0%  </Text>
        <Text color="cyan">{'> '}</Text>
        <Text>{input}</Text>
        <Text color="cyan">█</Text>
        {!input && <Text dimColor> write your main language</Text>}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Enter to confirm · Ctrl+C to exit</Text>
      </Box>
    </Box>
  )
}
