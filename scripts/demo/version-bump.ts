import { execFileSync } from 'node:child_process'
import { appendFileSync, readFileSync } from 'node:fs'
import { gt, valid } from 'semver'

export function isVersionBump(previous: string | undefined, current: string | undefined): boolean {
  if (!current || !valid(current)) return false
  if (!previous || !valid(previous)) return true
  return gt(current, previous)
}

function packageVersion(json: string): string | undefined {
  const value = JSON.parse(json) as { version?: unknown }
  return typeof value.version === 'string' ? value.version : undefined
}

function previousVersion(before: string): string | undefined {
  if (!before || /^0+$/.test(before)) return undefined
  return packageVersion(execFileSync('git', ['show', `${before}:package.json`], { encoding: 'utf8' }))
}

if (import.meta.main) {
  const before = process.env.GITHUB_EVENT_BEFORE ?? ''
  const current = packageVersion(readFileSync('package.json', 'utf8'))
  const record = isVersionBump(previousVersion(before), current)

  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `record=${record}\n`)
  console.log(record ? `Recording demo for v${current}` : 'No SemVer version increase; skipping demo recording.')
}
