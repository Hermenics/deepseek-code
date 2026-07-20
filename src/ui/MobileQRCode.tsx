import { useState, useEffect } from 'react'
import useInput from '../ink/hooks/use-input.js'
import type { Key } from '../ink/events/input-event.js'
import Box from '../ink/components/Box.js'
import Text from '../ink/components/Text.js'
import { getThemeColors } from './theme.js'
import type { ThemeName } from '../types/provider.js'

const IOS_URL = 'https://apps.apple.com/us/app/deepseek/id6737597349'
const ANDROID_URL = 'https://play.google.com/store/apps/details?id=com.deepseek.chat'

interface MobileQRCodeProps {
  onClose: () => void
  theme: ThemeName
}

type Platform = 'ios' | 'android'

export default function MobileQRCode({ onClose, theme }: MobileQRCodeProps) {
  const [platform, setPlatform] = useState<Platform>('ios')
  const [qrCodes, setQrCodes] = useState<Record<Platform, string>>({ ios: '', android: '' })
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const colors = getThemeColors(theme)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const QRCode = await import('qrcode')
        const [ios, android] = await Promise.all([
          QRCode.toString(IOS_URL, { type: 'utf8', errorCorrectionLevel: 'L', version: 4 }),
          QRCode.toString(ANDROID_URL, { type: 'utf8', errorCorrectionLevel: 'L', version: 4 }),
        ])
        if (!cancelled) {
          setQrCodes({ ios, android })
          setReady(true)
        }
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : String(cause))
        }
      }
    })()
    return () => { cancelled = true }
  }, [])

  useInput((input: string, key: Key) => {
    if (key.escape || input === 'q') {
      onClose()
      return
    }
    if (key.tab || key.leftArrow || key.rightArrow || key.upArrow || key.downArrow) {
      setPlatform((p) => (p === 'ios' ? 'android' : 'ios'))
    }
  })

  const url = platform === 'ios' ? IOS_URL : ANDROID_URL
  const qr = qrCodes[platform]

  if (error) {
    return (
      <Box flexDirection="column">
        <Text color="red">Unable to generate QR code: {error}</Text>
        <Text dimColor>Press Esc or q to close.</Text>
      </Box>
    )
  }

  if (!ready) {
    return (
      <Box flexDirection="column">
        <Text dimColor>Loading QR code…</Text>
      </Box>
    )
  }

  const qrLines = qr.split('\n')
  const height = qrLines.length

  // Place iOS at 1/3 from top, Android at 2/3 from top
  const iosRow = Math.floor(height / 3)
  const androidRow = Math.floor((height * 2) / 3)

  const sidebarLines = qrLines.map((_, i) => {
    if (i === iosRow) return { label: '› iOS', active: platform === 'ios' }
    if (i === androidRow) return { label: '› Android', active: platform === 'android' }
    return null
  })

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        <Text bold color={colors.primary}>DeepSeek Code · Mobile</Text>
      </Box>
      <Box flexDirection="row">
        {/* Sidebar */}
        <Box flexDirection="column" width={12} paddingRight={1}>
          {sidebarLines.map((item, i) =>
            item ? (
              <Text
                key={i}
                bold={item.active}
                color={item.active ? colors.primary : colors.textDim}
              >
                {item.active ? item.label : `  ${item.label.slice(2)}`}
              </Text>
            ) : (
              <Text key={i}>{' '}</Text>
            )
          )}
        </Box>
        {/* Separator — same pattern as ConfigMenu */}
        <Text color={colors.textInactive}>{'│\n'.repeat(height - 1)}│</Text>
        {/* QR + URL */}
        <Box flexDirection="column" paddingLeft={1}>
          {qrLines.map((line, i) => (
            <Text key={i}>{line}</Text>
          ))}
          <Text color={colors.textDim}>{url}</Text>
        </Box>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Tab/←→/↑↓ switch · Esc/q close</Text>
      </Box>
    </Box>
  )
}
