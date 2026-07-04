import { rm, mkdir } from 'fs/promises'
import { existsSync, readdirSync } from 'fs'
import { join, resolve, relative, isAbsolute } from 'path'
import { tmpdir } from 'os'
import { randomBytes } from 'crypto'
import type { PluginEntry } from './types.js'
import { readPluginRegistry, addPluginToRegistry, removePluginFromRegistry, getPluginsDir } from './registry.js'
import { discoverComponents, readPluginManifest } from './loader.js'

export interface InstallResult {
  ok: boolean
  name: string
  error?: string
}

const PLUGIN_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/

function isPathSafe(name: string): boolean {
  const base = resolve(getPluginsDir())
  const target = resolve(base, name)
  const rel = relative(base, target)
  return rel.length > 0 && !rel.startsWith('..') && !isAbsolute(rel)
}

function validatePluginName(name: string): boolean {
  return PLUGIN_NAME_PATTERN.test(name)
}

async function dirExists(path: string): Promise<boolean> {
  const proc = Bun.spawn(['test', '-d', path], { stdout: 'pipe', stderr: 'pipe' })
  return (await proc.exited) === 0
}

function detectPluginDir(tmpDir: string): string | null {
  if (existsSync(join(tmpDir, 'plugin.json'))) return tmpDir

  const pluginsDir = join(tmpDir, 'plugins')
  if (existsSync(pluginsDir)) {
    try {
      for (const d of readdirSync(pluginsDir, { withFileTypes: true })) {
        if (!d.isDirectory()) continue
        const subDir = join(pluginsDir, d.name)
        if (existsSync(join(subDir, 'plugin.json'))) return subDir
        if (existsSync(join(subDir, '.claude-plugin', 'plugin.json'))) return subDir
      }
    } catch { /* ignore */ }
  }

  return null
}

const REPO_PATTERN = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/

export async function installPlugin(repo: string): Promise<InstallResult> {
  if (!REPO_PATTERN.test(repo)) {
    return { ok: false, name: '', error: `Invalid repo format: "${repo}". Expected: owner/repo` }
  }
  const url = `https://github.com/${repo}.git`
  const tmpDir = join(tmpdir(), `dsk-plugin-${randomBytes(6).toString('hex')}`)

  try {
    const clone = Bun.spawn(['git', 'clone', '--depth', '1', url, tmpDir], {
      stdout: 'pipe', stderr: 'pipe',
    })
    const exitCode = await clone.exited
    if (exitCode !== 0) {
      const stderr = await new Response(clone.stderr).text()
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
      return { ok: false, name: '', error: `git clone failed: ${stderr.trim() || 'exit code ' + exitCode}` }
    }

    const pluginDir = detectPluginDir(tmpDir)
    if (!pluginDir) {
      await rm(tmpDir, { recursive: true, force: true })
      return { ok: false, name: '', error: 'Not a valid plugin: no plugin.json found' }
    }

    const manifest = readPluginManifest(pluginDir)
    if (!manifest) {
      await rm(tmpDir, { recursive: true, force: true })
      return { ok: false, name: '', error: 'Invalid plugin.json: missing or invalid "name" field' }
    }

    const { name } = manifest
    if (!validatePluginName(name) || !isPathSafe(name)) {
      await rm(tmpDir, { recursive: true, force: true })
      return { ok: false, name: '', error: `Invalid plugin name: '${name}'. Must be kebab-case.` }
    }

    const registry = readPluginRegistry()
    const targetDir = join(getPluginsDir(), name)
    if (registry.plugins[name]) {
      await rm(tmpDir, { recursive: true, force: true })
      return { ok: false, name, error: `Plugin '${name}' already installed. Use /plugin update ${name}` }
    }
    if (await dirExists(targetDir)) {
      await rm(tmpDir, { recursive: true, force: true })
      return { ok: false, name, error: `Plugin '${name}' directory already exists. Remove it first.` }
    }

    const hashProc = Bun.spawn(['git', 'rev-parse', 'HEAD'], { cwd: tmpDir, stdout: 'pipe' })
    await hashProc.exited
    const commitHash = (await new Response(hashProc.stdout).text()).trim()

    await rm(join(tmpDir, '.git'), { recursive: true, force: true })

    await mkdir(getPluginsDir(), { recursive: true })
    const mv = Bun.spawn(['mv', pluginDir, targetDir], { stdout: 'pipe', stderr: 'pipe' })
    const mvExit = await mv.exited
    if (mvExit !== 0) {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
      return { ok: false, name, error: 'Failed to move plugin into place' }
    }

    if (pluginDir !== tmpDir) {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
    }

    // ponytail: from here on, targetDir exists — clean it up on any failure
    let components
    try {
      components = discoverComponents(targetDir)
    } catch (discoverErr: any) {
      await rm(targetDir, { recursive: true, force: true }).catch(() => {})
      return { ok: false, name, error: `Failed to discover components: ${discoverErr.message}` }
    }

    const entry: PluginEntry = {
      name,
      repo,
      version: manifest.version || '0.0.0',
      installedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      commitHash,
      description: manifest.description || '',
      components,
    }

    try {
      addPluginToRegistry(entry)
    } catch (regErr: any) {
      await rm(targetDir, { recursive: true, force: true }).catch(() => {})
      return { ok: false, name, error: `Installed but failed to register: ${regErr.message}` }
    }

    return { ok: true, name }
  } catch (err: any) {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
    return { ok: false, name: '', error: err.message || String(err) }
  }
}

export async function removePlugin(name: string): Promise<InstallResult> {
  if (!validatePluginName(name) || !isPathSafe(name)) {
    return { ok: false, name, error: `Invalid plugin name: '${name}'` }
  }

  const registry = readPluginRegistry()
  if (!registry.plugins[name]) {
    return { ok: false, name, error: `Plugin '${name}' not found` }
  }

  const targetDir = join(getPluginsDir(), name)
  removePluginFromRegistry(name)
  await rm(targetDir, { recursive: true, force: true })

  return { ok: true, name }
}

export async function updatePlugin(name: string): Promise<InstallResult> {
  if (!validatePluginName(name) || !isPathSafe(name)) {
    return { ok: false, name, error: `Invalid plugin name: '${name}'` }
  }

  const registry = readPluginRegistry()
  const entry = registry.plugins[name]
  if (!entry) {
    return { ok: false, name, error: `Plugin '${name}' not installed. Use /plugin install` }
  }

  const { repo } = entry
  const url = `https://github.com/${repo}.git`
  const tmpDir = join(tmpdir(), `dsk-plugin-${randomBytes(6).toString('hex')}`)
  const targetDir = join(getPluginsDir(), name)
  const backupDir = join(tmpdir(), `dsk-plugin-backup-${randomBytes(6).toString('hex')}`)
  let backupDone = false

  try {
    // Clone new version
    const clone = Bun.spawn(['git', 'clone', '--depth', '1', url, tmpDir], {
      stdout: 'pipe', stderr: 'pipe',
    })
    const exitCode = await clone.exited
    if (exitCode !== 0) {
      const stderr = await new Response(clone.stderr).text()
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
      return { ok: false, name, error: `git clone failed: ${stderr.trim() || 'exit code ' + exitCode}` }
    }

    // Detect layout and validate new version
    const pluginDir = detectPluginDir(tmpDir)
    if (!pluginDir) {
      await rm(tmpDir, { recursive: true, force: true })
      return { ok: false, name, error: 'Update failed: no plugin.json in new version' }
    }

    const manifest = readPluginManifest(pluginDir)
    if (!manifest) {
      await rm(tmpDir, { recursive: true, force: true })
      return { ok: false, name, error: 'Update failed: invalid plugin.json in new version' }
    }

    if (manifest.name !== name) {
      await rm(tmpDir, { recursive: true, force: true })
      return { ok: false, name, error: `Plugin name mismatch: expected '${name}', got '${manifest.name}'` }
    }

    // Get commit hash
    const hashProc = Bun.spawn(['git', 'rev-parse', 'HEAD'], { cwd: tmpDir, stdout: 'pipe' })
    await hashProc.exited
    const commitHash = (await new Response(hashProc.stdout).text()).trim()

    // Remove .git
    await rm(join(tmpDir, '.git'), { recursive: true, force: true })

    // Backup existing → move new → cleanup
    const mvBackup = Bun.spawn(['mv', targetDir, backupDir], { stdout: 'pipe', stderr: 'pipe' })
    const mvBackupExit = await mvBackup.exited
    if (mvBackupExit !== 0) {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
      return { ok: false, name, error: 'Failed to backup existing plugin' }
    }
    backupDone = true

    // Move new into place
    const mv = Bun.spawn(['mv', pluginDir, targetDir], { stdout: 'pipe', stderr: 'pipe' })
    const mvExit = await mv.exited
    if (mvExit !== 0) {
      // Restore backup
      Bun.spawn(['mv', backupDir, targetDir], { stdout: 'pipe', stderr: 'pipe' })
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
      return { ok: false, name, error: 'Failed to move updated plugin into place (original restored)' }
    }

    if (pluginDir !== tmpDir) {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
    }

    // Discover components and update registry
    const components = discoverComponents(targetDir)
    try {
      addPluginToRegistry({
        name,
        repo,
        version: manifest.version || '0.0.0',
        installedAt: entry.installedAt,
        updatedAt: new Date().toISOString(),
        commitHash,
        description: manifest.description || '',
        components,
      })
    } catch (regErr: any) {
      // Restore backup on registry failure
      await rm(targetDir, { recursive: true, force: true }).catch(() => {})
      Bun.spawn(['mv', backupDir, targetDir], { stdout: 'pipe', stderr: 'pipe' })
      return { ok: false, name, error: `Update moved but registry failed: ${regErr.message}` }
    }

    // Cleanup backup
    await rm(backupDir, { recursive: true, force: true }).catch(() => {})

    return { ok: true, name }
  } catch (err: any) {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
    if (backupDone) {
      Bun.spawn(['mv', backupDir, targetDir], { stdout: 'pipe', stderr: 'pipe' })
    }
    return { ok: false, name, error: err.message || String(err) }
  }
}
