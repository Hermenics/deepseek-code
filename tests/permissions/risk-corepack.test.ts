import { describe, expect, it } from 'bun:test'
import { assessRisk, hasNetworkCapability, packageInstallLifecyclePolicy } from '../../src/permissions/risk.js'
import type { RiskContext } from '../../src/permissions/types.js'

const context = (): RiskContext => ({ isSubAgent: false, recentWriteCount: 0, config: { enabled: false } })

describe('Corepack package-manager installs', () => {
  for (const command of [
    'corepack pnpm install',
    "corepack pnpm 'install' --ignore-scripts",
    'corepack pnpm add zod',
    'corepack pnpm@9.15.0 --filter app install',
    'corepack yarn install',
    'corepack yarn add zod',
    'corepack npm install',
    'corepack npm add zod',
    'corepack npm update --offline',
    'corepack pnpm update --ignore-scripts',
    'corepack pnpm up --offline',
    'corepack yarn up --offline',
    'corepack yarn upgrade --offline',
    '/usr/bin/corepack pnpm install',
    'CI=1 corepack pnpm add zod',
    "sh -c 'corepack yarn install'",
  ]) {
    it(`${command} requires package-install approval and network access`, () => {
      expect(hasNetworkCapability('shell', { command })).toBe(true)
      expect(packageInstallLifecyclePolicy(command)).toBe('blocked')
      expect(assessRisk('shell', { command }, context())).toMatchObject({
        level: 'high',
        matchedRule: 'shell:package-install',
        requiresConfirmation: true,
      })
    })
  }

  it('does not treat quoted package-manager text as an invocation', () => {
    const command = "printf '%s' 'corepack pnpm install'"
    expect(hasNetworkCapability('shell', { command })).toBe(false)
    expect(assessRisk('shell', { command }, context())).toBeNull()
  })
})
