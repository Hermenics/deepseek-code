import { rm, mkdir } from 'fs/promises'
import { readFileSync } from 'fs'
import { join, resolve, relative, isAbsolute } from 'path'
import { tmpdir } from 'os'
import { randomBytes } from 'crypto'
import { parseSkillManifest, validateSkillName } from './validate.js'
import { readRegistry, addToRegistry, removeFromRegistry, type SkillEntry } from './registry.js'

export interface InstallResult {
  ok: boolean
  name: string
  error?: string
}

function isPathSafe(skillsDir: string, name: string): boolean {
  const base = resolve(skillsDir)
  const target = resolve(base, name)
  const rel = relative(base, target)
  return rel.length > 0 && !rel.startsWith('..') && !isAbsolute(rel)
}

async function dirExists(path: string): Promise<boolean> {
  const proc = Bun.spawn(['test', '-d', path], { stdout: 'pipe', stderr: 'pipe' })
  return (await proc.exited) === 0
}

export async function installSkill(repo: string, skillsDir: string): Promise<InstallResult> {
  const url = `https://github.com/${repo}.git`
  const tmpDir = join(tmpdir(), `dsk-skill-${randomBytes(6).toString('hex')}`)

  try {
    // Clone
    const clone = Bun.spawn(['git', 'clone', '--depth', '1', url, tmpDir], {
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const exitCode = await clone.exited
    if (exitCode !== 0) {
      const stderr = await new Response(clone.stderr).text()
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
      return { ok: false, name: '', error: `git clone failed: ${stderr.trim() || 'exit code ' + exitCode}` }
    }

    // Validate SKILL.md
    const skillMdPath = join(tmpDir, 'SKILL.md')
    let content: string
    try {
      content = readFileSync(skillMdPath, 'utf-8')
    } catch {
      await rm(tmpDir, { recursive: true, force: true })
      return { ok: false, name: '', error: 'Not a valid skill: missing SKILL.md' }
    }

    const manifest = parseSkillManifest(content)
    if ('error' in manifest) {
      await rm(tmpDir, { recursive: true, force: true })
      return { ok: false, name: '', error: manifest.error }
    }

    const { name } = manifest

    // Security: validate name won't escape skillsDir
    if (!validateSkillName(name) || !isPathSafe(skillsDir, name)) {
      await rm(tmpDir, { recursive: true, force: true })
      return { ok: false, name: '', error: `Invalid skill name: '${name}'` }
    }

    // Check if already installed (registry or filesystem)
    const registry = readRegistry(skillsDir)
    const targetDir = join(skillsDir, name)
    if (registry.skills[name]) {
      await rm(tmpDir, { recursive: true, force: true })
      return { ok: false, name, error: `Skill '${name}' already installed. Use /skill update ${name}` }
    }
    if (await dirExists(targetDir)) {
      await rm(tmpDir, { recursive: true, force: true })
      return { ok: false, name, error: `Skill '${name}' directory already exists. Remove it first or use /skill update ${name}` }
    }

    // Get commit hash
    const hashProc = Bun.spawn(['git', 'rev-parse', 'HEAD'], {
      cwd: tmpDir,
      stdout: 'pipe',
    })
    await hashProc.exited
    const commitHash = (await new Response(hashProc.stdout).text()).trim()

    // Remove .git
    await rm(join(tmpDir, '.git'), { recursive: true, force: true })

    // Ensure skillsDir exists and move
    await mkdir(skillsDir, { recursive: true })
    const mv = Bun.spawn(['mv', tmpDir, targetDir], { stdout: 'pipe', stderr: 'pipe' })
    const mvExit = await mv.exited
    if (mvExit !== 0) {
      const mvErr = await new Response(mv.stderr).text()
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
      return { ok: false, name, error: `Failed to move skill: ${mvErr.trim() || 'exit code ' + mvExit}` }
    }

    // Register — rollback on failure
    try {
      addToRegistry(skillsDir, {
        name,
        repo,
        installedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        commitHash,
        description: manifest.description,
      })
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

export async function removeSkill(name: string, skillsDir: string): Promise<InstallResult> {
  // Security: validate name
  if (!validateSkillName(name) || !isPathSafe(skillsDir, name)) {
    return { ok: false, name, error: `Invalid skill name: '${name}'` }
  }

  const registry = readRegistry(skillsDir)
  if (!registry.skills[name]) {
    return { ok: false, name, error: `Skill '${name}' not found` }
  }

  const targetDir = join(skillsDir, name)
  removeFromRegistry(skillsDir, name)
  await rm(targetDir, { recursive: true, force: true })

  return { ok: true, name }
}

export async function updateSkill(name: string, skillsDir: string): Promise<InstallResult> {
  // Security: validate name
  if (!validateSkillName(name) || !isPathSafe(skillsDir, name)) {
    return { ok: false, name, error: `Invalid skill name: '${name}'` }
  }

  const registry = readRegistry(skillsDir)
  const entry = registry.skills[name]
  if (!entry) {
    return { ok: false, name, error: `Skill '${name}' not installed. Use /skill install` }
  }

  const { repo } = entry
  const url = `https://github.com/${repo}.git`
  const tmpDir = join(tmpdir(), `dsk-skill-${randomBytes(6).toString('hex')}`)
  const targetDir = join(skillsDir, name)
  const backupDir = join(tmpdir(), `dsk-skill-backup-${randomBytes(6).toString('hex')}`)
  let backupDone = false

  try {
    const clone = Bun.spawn(['git', 'clone', '--depth', '1', url, tmpDir], {
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const exitCode = await clone.exited
    if (exitCode !== 0) {
      const stderr = await new Response(clone.stderr).text()
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
      return { ok: false, name, error: `git clone failed: ${stderr.trim() || 'exit code ' + exitCode}` }
    }

    // Validate SKILL.md
    const skillMdPath = join(tmpDir, 'SKILL.md')
    let content: string
    try {
      content = readFileSync(skillMdPath, 'utf-8')
    } catch {
      await rm(tmpDir, { recursive: true, force: true })
      return { ok: false, name, error: 'Update failed: SKILL.md missing in new version' }
    }

    const manifest = parseSkillManifest(content)
    if ('error' in manifest) {
      await rm(tmpDir, { recursive: true, force: true })
      return { ok: false, name, error: manifest.error }
    }

    // Verify manifest name matches the skill being updated
    if (manifest.name !== name) {
      await rm(tmpDir, { recursive: true, force: true })
      return { ok: false, name, error: `Skill name mismatch: expected '${name}', got '${manifest.name}'` }
    }

    // Get commit hash
    const hashProc = Bun.spawn(['git', 'rev-parse', 'HEAD'], {
      cwd: tmpDir,
      stdout: 'pipe',
    })
    await hashProc.exited
    const commitHash = (await new Response(hashProc.stdout).text()).trim()

    // Remove .git from new clone
    await rm(join(tmpDir, '.git'), { recursive: true, force: true })

    // Atomic-ish replace: backup old → move new → cleanup backup

    // Backup existing — must succeed before we proceed
    const mvBackup = Bun.spawn(['mv', targetDir, backupDir], { stdout: 'pipe', stderr: 'pipe' })
    const mvBackupExit = await mvBackup.exited
    if (mvBackupExit !== 0) {
      const backupErr = await new Response(mvBackup.stderr).text()
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
      return { ok: false, name, error: `Failed to backup existing skill: ${backupErr.trim() || 'exit code ' + mvBackupExit}` }
    }
    backupDone = true

    // Move new into place
    const mv = Bun.spawn(['mv', tmpDir, targetDir], { stdout: 'pipe', stderr: 'pipe' })
    const mvExit = await mv.exited
    if (mvExit !== 0) {
      // Restore backup
      const restore = Bun.spawn(['mv', backupDir, targetDir], { stdout: 'pipe', stderr: 'pipe' })
      const restoreExit = await restore.exited
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
      const restoreNote = restoreExit === 0 ? ' (original restored)' : ' (WARNING: restore also failed)'
      return { ok: false, name, error: `Failed to move updated skill into place${restoreNote}` }
    }

    // Update registry — rollback on failure
    try {
      addToRegistry(skillsDir, {
        name,
        repo,
        installedAt: entry.installedAt,
        updatedAt: new Date().toISOString(),
        commitHash,
        description: manifest.description,
      })
    } catch (regErr: any) {
      // Restore backup on registry failure
      await rm(targetDir, { recursive: true, force: true }).catch(() => {})
      const restore = Bun.spawn(['mv', backupDir, targetDir], { stdout: 'pipe', stderr: 'pipe' })
      await restore.exited
      return { ok: false, name, error: `Update moved but registry failed: ${regErr.message}` }
    }

    // Clean up backup
    await rm(backupDir, { recursive: true, force: true }).catch(() => {})

    return { ok: true, name }
  } catch (err: any) {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
    if (backupDone) {
      const restore = Bun.spawn(['mv', backupDir, targetDir], { stdout: 'pipe', stderr: 'pipe' })
      await restore.exited.catch(() => {})
    }
    return { ok: false, name, error: err.message || String(err) }
  }
}

export async function listSkills(skillsDir: string): Promise<SkillEntry[]> {
  const registry = readRegistry(skillsDir)
  return Object.values(registry.skills)
}
