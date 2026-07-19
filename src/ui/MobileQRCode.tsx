import { useState, useEffect } from 'react'
import useInput from '../ink/hooks/use-input.js'
import type { Key } from '../ink/events/input-event.js'
import Box from '../ink/components/Box.js'
import Text from '../ink/components/Text.js'

const IOS_URL = 'https://apps.apple.com/us/app/deepseek/id6737597349'
const ANDROID_URL = 'https://play.google.com/store/apps/details?id=com.deepseek.chat'

interface MobileQRCodeProps {
  onClose: () => void
}

type Platform = 'ios' | 'android'

export default function MobileQRCode({ onClose }: MobileQRCodeProps) {
  const [platform, setPlatform] = useState<Platform>('ios')
  const [qrCodes, setQrCodes] = useState<Record<Platform, string>>({ ios: '', android: '' })
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const QRCode = await import('qrcode')
      const [ios, android] = await Promise.all([
        QRCode.toString(IOS_URL, { type: 'utf8', errorCorrectionLevel: 'L' }),
        QRCode.toString(ANDROID_URL, { type: 'utf8', errorCorrectionLevel: 'L' }),
      ])
      if (!cancelled) {
        setQrCodes({ ios, android })
        setReady(true)
      }
    })()
    return () => { cancelled = true }
  }, [])

  useInput((input: string, key: Key) => {
    if (key.escape || input === 'q') {
      onClose()
      return
    }
    if (key.tab || key.leftArrow || key.rightArrow) {
      setPlatform((p) => (p === 'ios' ? 'android' : 'ios'))
    }
  })

  const url = platform === 'ios' ? IOS_URL : ANDROID_URL
  const qr = qrCodes[platform]

  if (!ready) {
    return (
      <Box flexDirection="column">
        <Text dimColor>Loading QR code…</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      <Text>{'\n'}</Text>
      <Text>{'\n'}</Text>
      <Text>{qr}</Text>
      <Text>{'\n'}</Text>
      <Text>{'\n'}</Text>
      <Box>
        <Text bold={platform === 'ios'} underline={platform === 'ios'}>iOS</Text>
        <Text dimColor> / </Text>
        <Text bold={platform === 'android'} underline={platform === 'android'}>Android</Text>
        <Text dimColor>{'          (tab to switch, esc to close)'}</Text>
      </Box>
      <Text dimColor>{url}</Text>
    </Box>
  )
}
