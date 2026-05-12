import { Tool } from './types.js'
import { execa } from 'execa'
import { SHELL_OUTPUT_MAX_CHARS, SHELL_TIMEOUT_MS } from '../constants.js'

const DESTRUCTIVE_PATTERNS = [
  /\brm\s+(-[a-z]*f[a-z]*|-[a-z]*r[a-z]*f[a-z]*|--force|--recursive)\b/i,
  /\bgit\s+(reset\s+--hard|clean\s+-[a-z]*f|push\s+--force|push\s+-f)\b/i,
  /\bdrop\s+(table|database)\b/i,
  /\btruncate\s+table\b/i,
  /\bmkfs\b/,
  /\bdd\s+.*of=/,
  /\bchmod\s+-R\s+777\b/,
  /\bsudo\s+rm\b/,
  />\s*\/dev\/(sd[a-z]|nvme)/,
]

function isDestructive(command: string): string | null {
  for (const pattern of DESTRUCTIVE_PATTERNS) {
    if (pattern.test(command)) return `Destructive command detected: ${command}`
  }
  return null
}

export type ConfirmHandler = (message: string) => Promise<boolean>

let globalConfirmHandler: ConfirmHandler | null = null

export function setShellConfirmHandler(handler: ConfirmHandler | null) {
  globalConfirmHandler = handler
}

export const Shell: Tool = {
  name: 'shell',
  description: 'Run a shell command.',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Shell command to run' },
      timeout: { type: 'number', description: 'Timeout in seconds (default: 30)' },
    },
    required: ['command'],
  },
  async execute(args) {
    const command = args.command as string
    const timeoutArg = args.timeout as number | undefined
    const timeout = timeoutArg != null && Number.isFinite(timeoutArg) && timeoutArg > 0 ? timeoutArg * 1000 : SHELL_TIMEOUT_MS

    const warning = isDestructive(command)
    if (warning && globalConfirmHandler) {
      const confirmed = await globalConfirmHandler(warning)
      if (!confirmed) return 'Command cancelled by user.'
    }

    try {
      const { stdout, stderr } = await execa(command, { shell: true, timeout })
      const out = [stdout, stderr].filter(Boolean).join('\n')
      return out.slice(0, SHELL_OUTPUT_MAX_CHARS) || '(no output)'
    } catch (e: unknown) {
      const err = e as { stdout?: string; stderr?: string; message?: string }
      return `Error: ${err.stderr || err.message || 'Command failed'}\n${err.stdout || ''}`.slice(0, SHELL_OUTPUT_MAX_CHARS)
    }
  },
}
