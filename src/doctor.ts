import { existsSync } from 'fs'
import { access, readFile } from 'fs/promises'
import { join } from 'path'
import { execa } from 'execa'
import { getCredentialsPath, getSettingsPath, loadMergedSettings } from './settings/index.js'

export interface DoctorCheck {
  name: string
  ok: boolean
  detail: string
}

export interface DoctorReport {
  cwd: string
  checks: DoctorCheck[]
}

async function commandAvailable(command: string): Promise<boolean> {
  const result = await execa(command, ['--version'], { reject: false, timeout: 2_000 })
  return result.exitCode === 0
}

async function inspectMcpConfig(cwd: string): Promise<DoctorCheck> {
  const path = join(cwd, '.deepseek', 'mcp.json')
  if (!existsSync(path)) return { name: 'MCP config', ok: true, detail: 'none configured' }
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as { servers?: unknown }
    const count = value.servers && typeof value.servers === 'object' ? Object.keys(value.servers).length : 0
    return { name: 'MCP config', ok: true, detail: `${count} server${count === 1 ? '' : 's'} configured` }
  } catch (error) {
    return { name: 'MCP config', ok: false, detail: `invalid JSON: ${(error as Error).message}` }
  }
}

export async function runDoctor(cwd = process.cwd()): Promise<DoctorReport> {
  const settings = await loadMergedSettings(cwd)
  const [git, rg, mcp] = await Promise.all([
    commandAvailable('git'),
    commandAvailable('rg'),
    inspectMcpConfig(cwd),
  ])
  const checks: DoctorCheck[] = [
    { name: 'Runtime', ok: Boolean(Bun.version), detail: `Bun ${Bun.version ?? process.version}` },
    { name: 'Workspace', ok: existsSync(cwd), detail: cwd },
    { name: 'Git', ok: git, detail: git ? 'available' : 'not found on PATH' },
    { name: 'ripgrep', ok: rg, detail: rg ? 'available' : 'not found on PATH; search may be slower' },
    { name: 'Credentials', ok: existsSync(getCredentialsPath()), detail: existsSync(getCredentialsPath()) ? 'configured' : 'not found; configure a provider before starting a session' },
    { name: 'Settings', ok: existsSync(getSettingsPath('user', cwd)) || Object.keys(settings).length > 0, detail: `provider: ${settings.provider?.name ?? 'deepseek'}` },
    mcp,
  ]

  try {
    await access(cwd)
  } catch {
    checks[1] = { name: 'Workspace', ok: false, detail: `${cwd} is not accessible` }
  }
  return { cwd, checks }
}

export function formatDoctorReport(report: DoctorReport): string {
  const lines = [`DeepSeek Code doctor · ${report.cwd}`, '']
  for (const check of report.checks) lines.push(`${check.ok ? '✓' : '✗'} ${check.name}: ${check.detail}`)
  const failed = report.checks.filter(check => !check.ok).length
  lines.push('', failed ? `${failed} check${failed === 1 ? '' : 's'} need attention.` : 'Everything looks ready.')
  return lines.join('\n')
}
