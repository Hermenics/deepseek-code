import { randomUUID } from 'crypto'
import { readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { execa, execaCommand } from 'execa'
import { withInkPaused } from '../../ink/root.js'

export function resolvePromptEditor(configured: string | undefined, hasNano: boolean, platform = process.platform, hasVi = false): string {
  if (configured) return configured
  if (hasNano) return 'nano'
  if (platform === 'win32') return 'notepad.exe'
  if (platform === 'darwin') return 'open -W -t'
  if (hasVi) return 'vi'
  throw new Error('No blocking prompt editor found. Set $VISUAL or $EDITOR.')
}

export async function editPromptMarkdown(name: string, initialValue: string): Promise<string> {
  const path = join(tmpdir(), `deepseek-${name}-${randomUUID()}.md`)
  await writeFile(path, initialValue, 'utf8')
  try {
    const configured = process.env.VISUAL || process.env.EDITOR
    const hasNano = configured ? false : await execa('nano', ['--version'], { stdio: 'ignore' }).then(() => true, () => false)
    const hasVi = configured || hasNano || process.platform !== 'linux' ? false : await execa('vi', ['--version'], { stdio: 'ignore' }).then(() => true, () => false)
    const editor = resolvePromptEditor(configured, hasNano, process.platform, hasVi)
    await withInkPaused(() => execaCommand(`${editor} ${path}`, { stdio: 'inherit' }).then(() => undefined))
    return await readFile(path, 'utf8')
  } finally {
    await rm(path, { force: true })
  }
}
