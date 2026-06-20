import { readFile, writeFile, readdir } from 'fs/promises'

export async function readJson<T = unknown>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf-8')) as T
}

export async function writeJson(path: string, data: unknown): Promise<void> {
  await writeFile(path, JSON.stringify(data, null, 2), 'utf-8')
}

export async function writeRaw(path: string, content: string): Promise<void> {
  await writeFile(path, content, 'utf-8')
}

export async function globFiles(pattern: RegExp, dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir)
    return entries.filter((f) => pattern.test(f))
  } catch {
    return []
  }
}
