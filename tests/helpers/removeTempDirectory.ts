import { rm } from 'node:fs/promises'

/** Windows can briefly keep SQLite files busy after the owning database is closed. */
export async function removeTempDirectory(directory: string): Promise<void> {
  await rm(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
}
