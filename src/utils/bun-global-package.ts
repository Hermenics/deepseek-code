import { homedir } from 'os'
import { join } from 'path'

export type GlobalPackageManager = 'bun' | 'npm'

export function isBunGlobalPackage(packageName: string): Promise<boolean> {
  const bunInstall = process.env.BUN_INSTALL ?? join(homedir(), '.bun')
  return Bun.file(join(bunInstall, 'install', 'global', 'node_modules', packageName, 'package.json')).exists()
}

export async function isNpmGlobalPackage(packageName: string): Promise<boolean> {
  try {
    const proc = Bun.spawnSync(['npm', 'root', '-g'], { stdout: 'pipe', stderr: 'ignore', env: process.env })
    return proc.exitCode === 0 && Bun.file(join(proc.stdout.toString().trim(), packageName, 'package.json')).exists()
  } catch {
    return false
  }
}

export async function getGlobalPackageManagers(packageName: string): Promise<GlobalPackageManager[]> {
  const [bun, npm] = await Promise.all([isBunGlobalPackage(packageName), isNpmGlobalPackage(packageName)])
  const managers: GlobalPackageManager[] = []
  if (npm) managers.push('npm')
  if (bun) managers.push('bun')
  return managers.length > 0 ? managers : ['npm']
}
