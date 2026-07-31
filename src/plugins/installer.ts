import { rm, mkdir } from 'fs/promises'
import { existsSync, readdirSync } from 'fs'
import { join, resolve, relative, isAbsolute } from 'path'
import { tmpdir } from 'os'
import { randomBytes } from 'crypto'
import type { PluginEntry } from './types.js'
import { readPluginRegistry, addPluginToRegistry, removePluginFromRegistry, getPluginsDir } from './registry.js'
import { discoverComponents, readPluginManifest } from './loader.js'
import { REPO_PATTERN, PLUGIN_NAME_PATTERN } from './validation.js'

export interface InstallResult {
  ok: boolean
  name: string
  error?: string
}

const CLONE_TIMEOUT_MS = 60_000

function isPathSafe(name: string): boolean {
  const base = resolve(getPluginsDir())
  const target = resolve(base, name)
  const rel = relative(base, target)
  return rel.length > 0 && !rel.startsWith('..') && !isAbsolute(rel)
}

function validatePluginName(name: string): boolean {
  return PLUGIN_NAME_PATTERN.test(name)
}

// ponytail: sync existsSync is sufficient; no need to spawn a process for a dir check
function dirExists(path: string): boolean {
  return existsSync(path)
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

/** Spawn a git clone with a hard timeout. Kills the process if the deadline is reached. */
async function spawnClone(url: string, dest: string): Promise<{ exitCode: number; stderr: string }> {
  const proc = Bun.spawn(['git', 'clone', '--depth', '1', url, dest], {
    env: process.env,
    stdout: 'pipe', stderr: 'pipe',
  })

  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    proc.kill()
  }, CLONE_TIMEOUT_MS)

  const exitCode = await proc.exited
  clearTimeout(timer)
  const stderr = timedOut
    ? `timed out after ${CLONE_TIMEOUT_MS / 1000}s`
    : (await new Response(proc.stderr).text()).trim()

  return { exitCode: timedOut ? -1 : exitCode, stderr }
}

/** Resolve a commit hash from cwd; returns null on failure. */
async function resolveCommitHash(cwd: string): Promise<string | null> {
  const proc = Bun.spawn(['git', 'rev-parse', 'HEAD'], {
    cwd, env: process.env, stdout: 'pipe', stderr: 'pipe',
  })
  const exitCode = await proc.exited
  if (exitCode !== 0) return null
  const hash = (await new Response(proc.stdout).text()).trim()
  return hash || null
}

/** Await a `mv` spawn and return its exit code. */
async function awaitedMv(src: string, dest: string): Promise<number> {
  const proc = Bun.spawn(['mv', src, dest], {
    env: process.env, stdout: 'pipe', stderr: 'pipe',
  })
  return proc.exited
}

export async function installPlugin(repo: string): Promise<InstallResult> {
  if (!REPO_PATTERN.test(repo)) {
    return { ok: false, name: '', error: `Invalid repo format: "${repo}". Expected: owner/repo` }
  }
  const url = `https://github.com/${repo}.git`
  const tmpDir = join(tmpdir(), `dsk-plugin-${randomBytes(6).toString('hex')}`)

  try {
    const { exitCode, stderr } = await spawnClone(url, tmpDir)
    if (exitCode !== 0) {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
      return { ok: false, name: '', error: `git clone failed: ${stderr || 'exit code ' + exitCode}` }
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
    if (dirExists(targetDir)) {
      await rm(tmpDir, { recursive: true, force: true })
      return { ok: false, name, error: `Plugin '${name}' directory already exists. Remove it first.` }
    }

    const commitHash = await resolveCommitHash(tmpDir)
    if (!commitHash) {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
      return { ok: false, name, error: 'Failed to read commit hash from cloned repo' }
    }

    await rm(join(tmpDir, '.git'), { recursive: true, force: true })

    await mkdir(getPluginsDir(), { recursive: true })
    const mvExit = await awaitedMv(pluginDir, targetDir)
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
      components = discoverComponents(targetDir, manifest)
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

  // Delete files first — only update the registry once the disk state is clean
  try {
    await rm(targetDir, { recursive: true, force: true })
  } catch (err: any) {
    return { ok: false, name, error: `Failed to remove plugin directory: ${err.message}` }
  }

  removePluginFromRegistry(name)
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
    const { exitCode, stderr } = await spawnClone(url, tmpDir)
    if (exitCode !== 0) {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
      return { ok: false, name, error: `git clone failed: ${stderr || 'exit code ' + exitCode}` }
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
    const commitHash = await resolveCommitHash(tmpDir)
    if (!commitHash) {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
      return { ok: false, name, error: 'Failed to read commit hash from cloned repo' }
    }

    // Remove .git
    await rm(join(tmpDir, '.git'), { recursive: true, force: true })

    // Backup existing → move new → cleanup
    const mvBackupExit = await awaitedMv(targetDir, backupDir)
    if (mvBackupExit !== 0) {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
      return { ok: false, name, error: 'Failed to backup existing plugin' }
    }
    backupDone = true

    // Move new into place
    const mvExit = await awaitedMv(pluginDir, targetDir)
    if (mvExit !== 0) {
      // Restore backup — await so we know it succeeded before reporting
      const restoreExit = await awaitedMv(backupDir, targetDir)
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
      const restoreNote = restoreExit === 0 ? ' (original restored)' : ' (restore also failed — backup at ' + backupDir + ')'
      return { ok: false, name, error: `Failed to move updated plugin into place${restoreNote}` }
    }

    if (pluginDir !== tmpDir) {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
    }

    // Discover components and update registry
    const components = discoverComponents(targetDir, manifest)
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
      // Restore backup on registry failure — await so we know the result
      await rm(targetDir, { recursive: true, force: true }).catch(() => {})
      const restoreExit = await awaitedMv(backupDir, targetDir)
      const restoreNote = restoreExit === 0 ? ' (original restored)' : ' (restore failed — backup at ' + backupDir + ')'
      return { ok: false, name, error: `Update moved but registry failed: ${regErr.message}${restoreNote}` }
    }

    // Cleanup backup
    await rm(backupDir, { recursive: true, force: true }).catch(() => {})

    return { ok: true, name }
  } catch (err: any) {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
    if (backupDone) {
      // Await restore so caller gets accurate state in the error message
      const restoreExit = await awaitedMv(backupDir, targetDir)
      const restoreNote = restoreExit === 0 ? ' (original restored)' : ' (restore failed — backup at ' + backupDir + ')'
      return { ok: false, name, error: (err.message || String(err)) + restoreNote }
    }
    return { ok: false, name, error: err.message || String(err) }
  }
}
