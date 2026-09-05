import { release, type as osType } from 'node:os'
import { basename } from 'node:path'
import { execa } from 'execa'

export interface EnvironmentInfo {
  workingDirectory: string
  additionalDirectories?: string[]
  platform: string
  osVersion: string
  shell: string
  isGitRepository: boolean
  gitBranch?: string
  model: string
  provider: string
  date: string
}

async function git(cwd: string, args: string[]): Promise<string | undefined> {
  try {
    const result = await execa('git', args, { cwd, reject: false, timeout: 3_000 })
    return result.exitCode === 0 ? result.stdout.trim() : undefined
  } catch { return undefined }
}

export async function collectEnvironmentInfo(options: {
  workingDirectory: string
  additionalDirectories?: string[]
  model: string
  provider: string
  now?: Date
}): Promise<EnvironmentInfo> {
  const [inside, branch] = await Promise.all([
    git(options.workingDirectory, ['rev-parse', '--is-inside-work-tree']),
    git(options.workingDirectory, ['branch', '--show-current']),
  ])
  const shellPath = process.env.SHELL || (process.platform === 'win32' ? 'powershell' : 'sh')
  return {
    workingDirectory: options.workingDirectory,
    ...(options.additionalDirectories?.length ? { additionalDirectories: options.additionalDirectories } : {}),
    platform: process.platform,
    osVersion: `${osType()} ${release()}`,
    shell: basename(shellPath),
    isGitRepository: inside === 'true',
    ...(branch ? { gitBranch: branch } : {}),
    model: options.model,
    provider: options.provider,
    date: (options.now ?? new Date()).toISOString().slice(0, 10),
  }
}

/**
 * Environment facts the model otherwise has to guess or discover with tool calls:
 * where it is, which OS and shell it is on, whether Git is available, and today's date.
 * Rendered as a plain block so it reads the same on every provider.
 */
export function formatEnvironmentInfo(info: EnvironmentInfo): string {
  const lines = [
    `Working directory: ${info.workingDirectory}`,
    ...(info.additionalDirectories?.length ? [`Additional working directories: ${info.additionalDirectories.join(', ')}`] : []),
    `Is a git repository: ${info.isGitRepository ? 'yes' : 'no'}${info.gitBranch ? ` (branch ${info.gitBranch})` : ''}`,
    `Platform: ${info.platform}`,
    `OS version: ${info.osVersion}`,
    `Shell: ${info.shell}${info.platform === 'win32' ? ' (use Unix shell syntax; forward slashes in paths)' : ''}`,
    `Model: ${info.model} via ${info.provider}`,
    `Today's date: ${info.date}`,
  ]
  return lines.join('\n')
}
