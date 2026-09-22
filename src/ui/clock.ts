import { useEffect, useState } from 'react'

// Single global interval — all subscribers share one tick
const subscribers = new Set<() => void>()
let interval: ReturnType<typeof setInterval> | null = null

function startClock() {
  if (interval) return
  interval = setInterval(() => {
    for (const fn of subscribers) fn()
  }, 80)
}

function stopClock() {
  if (interval && subscribers.size === 0) {
    clearInterval(interval)
    interval = null
  }
}

/** Returns a counter that increments every 80ms, driven by one shared interval that starts with the first subscriber and stops when the last unmounts. */
export function useClock(): number {
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const fn = () => setTick((t) => t + 1)
    subscribers.add(fn)
    startClock()
    return () => {
      subscribers.delete(fn)
      stopClock()
    }
  }, [])

  return tick
}
