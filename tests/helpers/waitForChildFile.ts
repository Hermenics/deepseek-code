import { existsSync } from 'node:fs'

/** Wait for a child process to publish a filesystem barrier without relying on IPC delivery. */
export async function waitForChildFile(
  path: string,
  child: ReturnType<typeof Bun.spawn>,
  errors: Promise<string>,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!existsSync(path)) {
    if (child.exitCode !== null) throw new Error(await errors)
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for child marker: ${path}`)
    await Bun.sleep(10)
  }
}
