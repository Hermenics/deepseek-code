import { homedir } from 'node:os'
import { isAbsolute, join, relative, resolve, dirname } from 'node:path'
import { lstat, readdir, readFile, realpath, stat } from 'node:fs/promises'
import type { CommandResult } from './types.js'

const MAX_COMMANDS_PER_DIRECTORY = 256
const MAX_COMMAND_BYTES = 128 * 1024
const NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/

export interface CustomCommand {
  name: string
  description: string
  prompt: string
  path: string
  source: 'project' | 'user'
}

let cached = new Map<string, CustomCommand>()

function contained(root: string, target: string): boolean {
  const child = relative(root, target)
  return child === '' || (!child.startsWith('..') && !isAbsolute(child))
}

async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true } catch { return false }
}

async function projectDirectories(start: string): Promise<string[]> {
  const directories: string[] = []
  let current = resolve(start)
  while (true) {
    const candidate = join(current, '.deepseek', 'commands')
    try {
      if ((await lstat(candidate)).isDirectory()) directories.push(candidate)
    } catch { /* absent */ }
    if (await exists(join(current, '.git'))) break
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return directories
}

function stripQuotes(value: string): string {
  return (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))
    ? value.slice(1, -1)
    : value
}

function parseCommandFile(content: string): { description: string; prompt: string } | null {
  const lines = content.split('\n')
  let bodyStart = 0
  let description = ''
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---')
    if (end < 0) return null
    for (const line of lines.slice(1, end)) {
      const match = /^description\s*:\s*(.*)$/i.exec(line.trim())
      if (match) description = stripQuotes(match[1]!.trim())
    }
    bodyStart = end + 1
  }
  const prompt = lines.slice(bodyStart).join('\n').trim()
  if (!prompt) return null
  return { description: description || 'Custom prompt command', prompt }
}

async function readDirectory(directory: string, source: CustomCommand['source']): Promise<CustomCommand[]> {
  let root: string
  try {
    if ((await lstat(directory)).isSymbolicLink()) return []
    root = await realpath(directory)
  } catch { return [] }

  const entries = (await readdir(directory, { withFileTypes: true }).catch(() => []))
    .filter(entry => entry.name.endsWith('.md') && (entry.isFile() || entry.isSymbolicLink()))
    .slice(0, MAX_COMMANDS_PER_DIRECTORY)

  return (await Promise.all(entries.map(async entry => {
    const name = entry.name.slice(0, -3)
    if (!NAME_PATTERN.test(name)) return undefined
    const path = join(directory, entry.name)
    try {
      const resolvedPath = await realpath(path)
      if (!contained(root, resolvedPath)) return undefined
      if ((await stat(resolvedPath)).size > MAX_COMMAND_BYTES) return undefined
      const parsed = parseCommandFile(await readFile(resolvedPath, 'utf8'))
      return parsed ? { name, ...parsed, path, source } : undefined
    } catch { return undefined }
  }))).filter((command): command is CustomCommand => Boolean(command))
}

export async function discoverCustomCommands(cwd: string): Promise<CustomCommand[]> {
  const directories = await projectDirectories(cwd)
  const groups = [
    ...(await Promise.all(directories.map(directory => readDirectory(directory, 'project')))),
    await readDirectory(join(homedir(), '.deepseek', 'commands'), 'user'),
  ]
  const selected = new Map<string, CustomCommand>()
  for (const command of groups.flat()) if (!selected.has(command.name)) selected.set(command.name, command)
  return [...selected.values()]
}

export async function refreshCustomCommands(cwd: string): Promise<void> {
  cached = new Map((await discoverCustomCommands(cwd)).map(command => [command.name, command]))
}

export function getCustomCommandSuggestions(): string[] {
  return [...cached.keys()].map(name => `/${name}`)
}

export function getCustomCommandDescriptions(): Record<string, string> {
  return Object.fromEntries([...cached.values()].map(command => [`/${command.name}`, command.description]))
}

function expandPrompt(prompt: string, args: string): string {
  const positional = args ? args.split(/\s+/) : []
  let expanded = prompt.replace(/\$ARGUMENTS\b/g, args)
  expanded = expanded.replace(/\$(\d+)/g, (_, index: string) => positional[Number(index) - 1] ?? '')
  return args && !prompt.includes('$ARGUMENTS') && !/\$\d+/.test(prompt)
    ? `${expanded}\n\nArguments: ${args}`
    : expanded
}

export async function resolveCustomCommand(input: string, cwd: string): Promise<CommandResult | null> {
  const match = /^\/([a-z0-9][a-z0-9-]{0,63})(?:\s+([\s\S]*))?$/.exec(input.trim())
  if (!match) return null
  await refreshCustomCommands(cwd)
  const command = cached.get(match[1]!)
  if (!command) return null
  return { type: 'custom', name: command.name, prompt: expandPrompt(command.prompt, match[2]?.trim() ?? '') }
}
