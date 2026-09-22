import { join } from 'path'
import { homedir } from 'os'
import { mkdir, appendFile, chmod } from 'fs/promises'
import { randomBytes } from 'crypto'
import { redactSecrets } from '../orchestration/events.js'

const LOG_DIR = join(homedir(), '.deepseek', 'logs')
const SESSION_ID = `${Date.now()}-${randomBytes(3).toString('hex')}`
const LOG_FILE = join(LOG_DIR, `session-${SESSION_ID}.jsonl`)

export type AuditEvent =
  | { type: 'session_start'; model: string; provider: string; cwd: string }
  | { type: 'tool_call'; tool: string; args: Record<string, unknown> }
  | { type: 'tool_result'; tool: string; result: string; durationMs: number }
  | { type: 'compact'; reason: string }
  | { type: 'compact_error'; reason: string }
  | { type: 'checkpoint'; id: string; label?: string }
  | { type: 'session_end'; totalTokens: number }
  | { type: 'mcp_server_load'; serverName: string; transport: string }

let initialized = false

async function ensureDir(): Promise<void> {
  if (initialized) return
  await mkdir(LOG_DIR, { recursive: true })
  initialized = true
}

/** Appends a timestamped, secret-redacted event to this process's JSONL audit log (mode 0600). Never throws. */
export async function auditLog(event: AuditEvent): Promise<void> {
  try {
    await ensureDir()
    const line = JSON.stringify(redactSecrets({ ts: new Date().toISOString(), ...event })) + '\n'
    await appendFile(LOG_FILE, line, { encoding: 'utf8', mode: 0o600 })
    await chmod(LOG_FILE, 0o600)
  } catch {
    // Audit log failures must never crash the agent
  }
}

/** Returns the path of the audit log for the current process (one file per session under ~/.deepseek/logs). */
export function getLogFile(): string {
  return LOG_FILE
}
