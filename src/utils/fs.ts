import { chmod, readFile, writeFile, readdir } from 'fs/promises'

/** Reads and parses a UTF-8 JSON file; throws if it is missing or invalid. */
export async function readJson<T = unknown>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf-8')) as T
}

/** Writes pretty-printed JSON with owner-only (0600) permissions, re-applied in case the file already existed. */
export async function writeJson(path: string, data: unknown): Promise<void> {
  await writeFile(path, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 })
  await chmod(path, 0o600)
}

/** Writes text with owner-only (0600) permissions, re-applied in case the file already existed. */
export async function writeRaw(path: string, content: string): Promise<void> {
  await writeFile(path, content, { encoding: 'utf8', mode: 0o600 })
  await chmod(path, 0o600)
}

/** Lists entry names directly inside `dir` that match the regex (non-recursive); returns [] if the directory cannot be read. */
export async function globFiles(pattern: RegExp, dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir)
    return entries.filter((f) => pattern.test(f))
  } catch {
    return []
  }
}
