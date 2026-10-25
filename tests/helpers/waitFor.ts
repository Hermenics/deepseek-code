import { setTimeout as delay } from 'node:timers/promises'

/** Poll an observable condition, not a scheduler-dependent number of timer ticks. */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  description: string,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = performance.now() + timeoutMs
  const timeout = () => new Error(`Timed out waiting for ${description} (${timeoutMs}ms)`)
  while (true) {
    const result = condition()
    if (typeof result === 'boolean') {
      if (result) return
    } else {
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        const ready = await Promise.race([result, new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(timeout()), Math.max(0, deadline - performance.now()))
        })])
        if (performance.now() >= deadline) throw timeout()
        if (ready) return
      } finally { clearTimeout(timer) }
    }
    if (performance.now() >= deadline) throw timeout()
    await delay(Math.min(10, Math.max(1, deadline - performance.now())))
  }
}
