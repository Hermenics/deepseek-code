import { rm } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'

/** Windows can briefly keep SQLite files busy after the owning database is closed. */
export async function removeTempDirectory(directory: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await rm(directory, { recursive: true, force: true })
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (process.platform !== 'win32' || !['EBUSY', 'EPERM', 'ENOTEMPTY'].includes(code ?? '')) throw error
      // Hosted Windows runners can hold a closed SQLite temp directory until process exit.
      if (code === 'EBUSY' && attempt >= 4) return
      if (attempt >= 4) throw error
      await delay(100)
    }
  }
}
