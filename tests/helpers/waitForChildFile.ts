import { existsSync } from 'node:fs'
import { waitFor } from './waitFor.js'

/** Wait for a child process to publish a filesystem barrier without relying on IPC delivery. */
export async function waitForChildFile(
  path: string,
  child: ReturnType<typeof Bun.spawn>,
  errors: Promise<string>,
  timeoutMs = 5_000,
): Promise<void> {
  await waitFor(async () => {
    if (existsSync(path)) return true
    if (child.exitCode !== null) throw new Error(`Child exited with code ${child.exitCode} before publishing ${path}: ${await errors}`)
    return false
  }, `child marker: ${path}`, timeoutMs)
}
