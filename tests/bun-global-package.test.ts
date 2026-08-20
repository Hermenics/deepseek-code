import { describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { getGlobalPackageManagers, isBunGlobalPackage, isNpmGlobalPackage } from '../src/utils/bun-global-package.js'
import { hasBinary } from '../src/utils/platform.js'

describe('isBunGlobalPackage', () => {
  it('returns false when the package is not installed globally with Bun', async () => {
    const bunInstall = await mkdtemp(join(tmpdir(), 'deepseek-bun-global-'))
    try {
      expect(await isBunGlobalPackage('@hermenics/deepseek-code', { ...process.env, BUN_INSTALL: bunInstall })).toBe(false)
    } finally {
      await rm(bunInstall, { recursive: true, force: true })
    }
  })

  it('returns true when the package is installed globally with Bun', async () => {
    const bunInstall = await mkdtemp(join(tmpdir(), 'deepseek-bun-global-'))
    const packageDir = join(bunInstall, 'install', 'global', 'node_modules', '@hermenics', 'deepseek-code')
    try {
      await mkdir(packageDir, { recursive: true })
      await writeFile(join(packageDir, 'package.json'), '{}')
      expect(await isBunGlobalPackage('@hermenics/deepseek-code', { ...process.env, BUN_INSTALL: bunInstall })).toBe(true)
    } finally {
      await rm(bunInstall, { recursive: true, force: true })
    }
  })

  it('detects global npm and Bun installations together', async () => {
    const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
    if (!hasBinary(npmCommand)) return
    const bunInstall = await mkdtemp(join(tmpdir(), 'deepseek-bun-global-'))
    const npmPrefix = await mkdtemp(join(tmpdir(), 'deepseek-npm-global-'))
    const env = { ...process.env, BUN_INSTALL: bunInstall, npm_config_prefix: npmPrefix }
    const bunPackageDir = join(bunInstall, 'install', 'global', 'node_modules', '@hermenics', 'deepseek-code')
    try {
      const npmRoot = Bun.spawnSync([npmCommand, 'root', '-g'], { stdout: 'pipe', stderr: 'ignore', env })
      const npmModules = npmRoot.exitCode === 0 ? npmRoot.stdout.toString().trim() : ''
      const npmPackageDir = join(npmModules || (process.platform === 'win32' ? join(npmPrefix, 'node_modules') : join(npmPrefix, 'lib', 'node_modules')), '@hermenics', 'deepseek-code')
      await Promise.all([mkdir(bunPackageDir, { recursive: true }), mkdir(npmPackageDir, { recursive: true })])
      await Promise.all([writeFile(join(bunPackageDir, 'package.json'), '{}'), writeFile(join(npmPackageDir, 'package.json'), '{}')])

      expect(await isNpmGlobalPackage('@hermenics/deepseek-code', env)).toBe(true)
      expect(await getGlobalPackageManagers('@hermenics/deepseek-code', env)).toEqual(['npm', 'bun'])
    } finally {
      await Promise.all([
        rm(bunInstall, { recursive: true, force: true }),
        rm(npmPrefix, { recursive: true, force: true }),
      ])
    }
  })
})
