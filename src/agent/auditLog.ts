import { join } from 'path'
import { mkdir, appendFile } from 'fs/promises'

const LOG_DIR = join(process.cwd(), '.deepseek', 'logs')
const SESSION_ID = Date.now().toString()
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

export async function auditLog(event: AuditEvent): Promise<void> {
  try {
    await ensureDir()
    const line = JSON.stringify({ ts: new Date().toISOString(), ...event }) + '\n'
    await appendFile(LOG_FILE, line, 'utf-8')
  } catch {
    // Audit log failures must never crash the agent
  }
}

export function getLogFile(): string {
  return LOG_FILE
}
