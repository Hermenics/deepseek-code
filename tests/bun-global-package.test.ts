import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { getGlobalPackageManagers, isBunGlobalPackage, isNpmGlobalPackage } from '../src/utils/bun-global-package.js'

let bunInstall: string
let npmPrefix: string
const previousBunInstall = process.env.BUN_INSTALL
const previousNpmPrefix = process.env.npm_config_prefix

beforeEach(async () => {
  bunInstall = await mkdtemp(join(tmpdir(), 'deepseek-bun-global-'))
  npmPrefix = await mkdtemp(join(tmpdir(), 'deepseek-npm-global-'))
  process.env.BUN_INSTALL = bunInstall
  process.env.npm_config_prefix = npmPrefix
})

afterEach(async () => {
  await rm(bunInstall, { recursive: true, force: true })
  await rm(npmPrefix, { recursive: true, force: true })
  if (previousBunInstall === undefined) delete process.env.BUN_INSTALL
  else process.env.BUN_INSTALL = previousBunInstall
  if (previousNpmPrefix === undefined) delete process.env.npm_config_prefix
  else process.env.npm_config_prefix = previousNpmPrefix
})

describe('isBunGlobalPackage', () => {
  it('returns false when the package is not installed globally with Bun', async () => {
    expect(await isBunGlobalPackage('@hermenics/deepseek-code')).toBe(false)
  })

  it('returns true when the package is installed globally with Bun', async () => {
    const packageDir = join(bunInstall, 'install', 'global', 'node_modules', '@hermenics', 'deepseek-code')
    await mkdir(packageDir, { recursive: true })
    await writeFile(join(packageDir, 'package.json'), '{}')

    expect(await isBunGlobalPackage('@hermenics/deepseek-code')).toBe(true)
  })

  it('detects global npm and Bun installations together', async () => {
    const bunPackageDir = join(bunInstall, 'install', 'global', 'node_modules', '@hermenics', 'deepseek-code')
    const npmRoot = Bun.spawnSync(['npm', 'root', '-g'], { stdout: 'pipe', stderr: 'ignore', env: process.env })
    const npmModules = npmRoot.exitCode === 0 ? npmRoot.stdout.toString().trim() : ''
    const npmPackageDir = join(npmModules || (process.platform === 'win32' ? join(npmPrefix, 'node_modules') : join(npmPrefix, 'lib', 'node_modules')), '@hermenics', 'deepseek-code')
    await Promise.all([mkdir(bunPackageDir, { recursive: true }), mkdir(npmPackageDir, { recursive: true })])
    await Promise.all([writeFile(join(bunPackageDir, 'package.json'), '{}'), writeFile(join(npmPackageDir, 'package.json'), '{}')])

    expect(await isNpmGlobalPackage('@hermenics/deepseek-code')).toBe(true)
    expect(await getGlobalPackageManagers('@hermenics/deepseek-code')).toEqual(['npm', 'bun'])
  })
})
