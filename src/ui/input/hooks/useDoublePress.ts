import { useState, useRef, useCallback } from 'react'

interface UseDoublePressOptions {
  timeout?: number
  onFirstPress?: () => void
  onDoublePress: () => void
}

interface UseDoublePressResult {
  armed: boolean
  trigger: () => void
  reset: () => void
}

export function useDoublePress(options: UseDoublePressOptions): UseDoublePressResult {
  const { timeout = 800, onFirstPress, onDoublePress } = options
  const [armed, setArmed] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const reset = useCallback(() => {
    setArmed(false)
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const trigger = useCallback(() => {
    if (armed) {
      reset()
      onDoublePress()
    } else {
      setArmed(true)
      onFirstPress?.()
      timerRef.current = setTimeout(() => {
        setArmed(false)
      }, timeout)
    }
  }, [armed, timeout, onFirstPress, onDoublePress, reset])

  return { armed, trigger, reset }
}
