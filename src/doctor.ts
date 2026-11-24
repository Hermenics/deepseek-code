import { existsSync } from 'fs'
import { access, readFile } from 'fs/promises'
import { basename, join } from 'path'
import { execa } from 'execa'
import { getCredentialsPath, getSettingsPath, loadMergedSettings } from './settings/index.js'
import { isEnabled, loadFeatures } from './features.js'
import { cliStyle as ink } from './utils/cli-style.js'
import { findChromium, isLinux } from './utils/platform.js'
import { checkMcpCatalog } from './commands/doctor/mcp.js'
import { formatProviderProbe, loadDoctorProviderConfig, probeProviderCatalog, type ProviderProbeResult } from './commands/doctor/provider.js'

export interface DoctorCheck {
  name: string
  ok: boolean
  detail: string
}

export interface DoctorReport {
  cwd: string
  checks: DoctorCheck[]
}

/** Probes a binary by running `<command> --version` with a 2s timeout; never throws. */
async function commandAvailable(command: string): Promise<boolean> {
  const result = await execa(command, ['--version'], { reject: false, timeout: 2_000 })
  return result.exitCode === 0
}

/** Checks `.deepseek/mcp.json` in the workspace: a missing file passes, invalid JSON fails. */
async function inspectMcpConfig(cwd: string): Promise<DoctorCheck> {
  const path = join(cwd, '.deepseek', 'mcp.json')
  if (!existsSync(path)) return { name: 'MCP config', ok: true, detail: 'none configured' }
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as { servers?: unknown }
    if (!value || typeof value !== 'object' || !value.servers || typeof value.servers !== 'object' || Array.isArray(value.servers)) {
      return { name: 'MCP config', ok: false, detail: 'invalid server configuration' }
    }
    const count = Object.keys(value.servers).length
    return { name: 'MCP config', ok: true, detail: `${count} server${count === 1 ? '' : 's'} configured` }
  } catch {
    return { name: 'MCP config', ok: false, detail: 'invalid JSON' }
  }
}

/** Checks the optional browser runtime without starting it. */
async function inspectBrowser(): Promise<DoctorCheck> {
  const executable = process.env.DEEPSEEK_CHROME_PATH || findChromium()
  if (!executable) return { name: 'Browser', ok: false, detail: 'Chrome, Chromium, Edge or Brave not found' }
  try {
    const result = await execa(executable, ['--version'], { reject: false, timeout: 2_000 })
    const version = (result.stdout || result.stderr).trim()
    if (result.exitCode !== 0 || !version) return { name: 'Browser', ok: false, detail: `${basename(executable)} found, but its version could not be read` }
    const display = !isLinux || process.env.DISPLAY || process.env.WAYLAND_DISPLAY
      ? 'visible window: display available'
      : 'visible window: no DISPLAY or WAYLAND_DISPLAY (headless still works)'
    return { name: 'Browser', ok: true, detail: `${basename(executable)} · ${version}; ${display}` }
  } catch {
    return { name: 'Browser', ok: false, detail: `${basename(executable)} found, but it could not run --version` }
  }
}

/** Runs local environment checks and separate provider-catalog and approved-MCP diagnostics for a workspace. */
export async function runDoctor(cwd = process.cwd()): Promise<DoctorReport> {
  const settings = await loadMergedSettings(cwd)
  const browserCheck = isEnabled('browser', loadFeatures()) ? inspectBrowser() : Promise.resolve(null)
  const [git, rg, mcp, browser] = await Promise.all([
    commandAvailable('git'),
    commandAvailable('rg'),
    inspectMcpConfig(cwd),
    browserCheck,
  ])
  const [providerResult, mcpCatalog] = await Promise.all([
    loadDoctorProviderConfig(cwd).then(probeProviderCatalog).catch((): ProviderProbeResult => ({ provider: 'Provider', status: 'configuration-error' })),
    checkMcpCatalog(cwd, settings.mcp?.enabled === true),
  ])
  const provider = formatProviderProbe(providerResult)
  const checks: DoctorCheck[] = [
    { name: 'Runtime', ok: Boolean(Bun.version), detail: `Bun ${Bun.version ?? process.version}` },
    { name: 'Workspace', ok: existsSync(cwd), detail: cwd },
    { name: 'Git', ok: git, detail: git ? 'available' : 'not found on PATH' },
    { name: 'ripgrep', ok: rg, detail: rg ? 'available' : 'not found on PATH; search may be slower' },
    { name: 'Credentials', ok: existsSync(getCredentialsPath()), detail: existsSync(getCredentialsPath()) ? 'configured' : 'not found; configure a provider before starting a session' },
    { name: 'Settings', ok: existsSync(getSettingsPath('user', cwd)) || Object.keys(settings).length > 0, detail: `provider: ${settings.provider?.name ?? 'deepseek'}` },
    mcp,
    { name: 'Provider catalog', ...provider },
    mcpCatalog,
    ...(browser ? [browser] : []),
  ]

  try {
    await access(cwd)
  } catch {
    checks[1] = { name: 'Workspace', ok: false, detail: `${cwd} is not accessible` }
  }
  return { cwd, checks }
}

/** Formats a doctor report as a checklist with a one-line summary of failed checks. */
export function formatDoctorReport(report: DoctorReport, styled = false): string {
  const lines = [styled ? `${ink.bold.cyan('DeepSeek Code')} ${ink.dim('· Setup check')}\n${ink.dim(report.cwd)}` : `DeepSeek Code doctor · ${report.cwd}`, '']
  for (const check of report.checks) lines.push(styled ? `${check.ok ? ink.green('✓') : ink.red('!')} ${ink.bold(check.name)} ${ink.dim('·')} ${check.detail}` : `${check.ok ? '✓' : '✗'} ${check.name}: ${check.detail}`)
  const failed = report.checks.filter(check => !check.ok).length
  lines.push('', styled ? failed ? ink.yellow(`${failed} item${failed === 1 ? '' : 's'} need attention.`) : ink.green('Everything looks ready.') : failed ? `${failed} check${failed === 1 ? '' : 's'} need attention.` : 'Everything looks ready.')
  return lines.join('\n')
}
