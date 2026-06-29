import { describe, it, expect } from 'bun:test'
import { assessRisk, DEFAULT_RISK_RULES } from '../../src/permissions/risk.js'
import type { RiskContext } from '../../src/permissions/types.js'

// Helper
const ctx = (overrides?: Partial<RiskContext>): RiskContext => ({
  isSubAgent: false,
  recentWriteCount: 0,
  config: {},
  ...overrides,
})

describe('assessRisk', () => {
  describe('HIGH risk', () => {
    it('rm -rf /tmp → HIGH, requires confirmation', () => {
      const r = assessRisk('shell', { command: 'rm -rf /tmp' }, ctx())
      expect(r).not.toBeNull()
      expect(r!.level).toBe('high')
      expect(r!.requiresConfirmation).toBe(true)
    })

    it('git push --force → HIGH, requires confirmation', () => {
      const r = assessRisk('shell', { command: 'git push --force' }, ctx())
      expect(r).not.toBeNull()
      expect(r!.level).toBe('high')
      expect(r!.requiresConfirmation).toBe(true)
    })

    it('git reset --hard → HIGH, requires confirmation', () => {
      const r = assessRisk('shell', { command: 'git reset --hard' }, ctx())
      expect(r).not.toBeNull()
      expect(r!.level).toBe('high')
      expect(r!.requiresConfirmation).toBe(true)
    })

    it('sudo apt install vim → HIGH, requires confirmation', () => {
      const r = assessRisk('shell', { command: 'sudo apt install vim' }, ctx())
      expect(r).not.toBeNull()
      expect(r!.level).toBe('high')
      expect(r!.requiresConfirmation).toBe(true)
    })

    it('npm install lodash → HIGH, requires confirmation', () => {
      const r = assessRisk('shell', { command: 'npm install lodash' }, ctx())
      expect(r).not.toBeNull()
      expect(r!.level).toBe('high')
      expect(r!.requiresConfirmation).toBe(true)
    })

    it('bun add zod → HIGH, requires confirmation', () => {
      const r = assessRisk('shell', { command: 'bun add zod' }, ctx())
      expect(r).not.toBeNull()
      expect(r!.level).toBe('high')
      expect(r!.requiresConfirmation).toBe(true)
    })

    it('write_file with .deepseek/config.json → HIGH', () => {
      const r = assessRisk('write_file', { path: '.deepseek/config.json' }, ctx())
      expect(r).not.toBeNull()
      expect(r!.level).toBe('high')
      expect(r!.requiresConfirmation).toBe(true)
    })

    it('write_file with _existingLineCount: 150 → HIGH (large_overwrite)', () => {
      const r = assessRisk('write_file', { path: 'src/foo.ts', _existingLineCount: 150 }, ctx())
      expect(r).not.toBeNull()
      expect(r!.level).toBe('high')
      expect(r!.matchedRule).toBe('write:large-overwrite')
      expect(r!.requiresConfirmation).toBe(true)
    })

    it('chmod 777 /etc → HIGH', () => {
      const r = assessRisk('shell', { command: 'chmod 777 /etc' }, ctx())
      expect(r).not.toBeNull()
      expect(r!.level).toBe('high')
      expect(r!.requiresConfirmation).toBe(true)
    })

    it('systemctl restart nginx → HIGH', () => {
      const r = assessRisk('shell', { command: 'systemctl restart nginx' }, ctx())
      expect(r).not.toBeNull()
      expect(r!.level).toBe('high')
      expect(r!.requiresConfirmation).toBe(true)
    })
  })

  describe('MEDIUM risk', () => {
    it('git push origin main (no --force) → MEDIUM, no confirmation for main agent', () => {
      const r = assessRisk('shell', { command: 'git push origin main' }, ctx())
      expect(r).not.toBeNull()
      expect(r!.level).toBe('medium')
      expect(r!.requiresConfirmation).toBe(false)
    })

    it('git push origin main → MEDIUM, requires confirmation if subagent', () => {
      const r = assessRisk('shell', { command: 'git push origin main' }, ctx({ isSubAgent: true }))
      expect(r).not.toBeNull()
      expect(r!.level).toBe('medium')
      expect(r!.requiresConfirmation).toBe(true)
    })

    it('git commit -m "test" → MEDIUM, no confirmation for main agent', () => {
      const r = assessRisk('shell', { command: 'git commit -m "test"' }, ctx())
      expect(r).not.toBeNull()
      expect(r!.level).toBe('medium')
      expect(r!.requiresConfirmation).toBe(false)
    })

    it('git commit -m "test" → MEDIUM, requires confirmation if subagent', () => {
      const r = assessRisk('shell', { command: 'git commit -m "test"' }, ctx({ isSubAgent: true }))
      expect(r).not.toBeNull()
      expect(r!.level).toBe('medium')
      expect(r!.requiresConfirmation).toBe(true)
    })

    it('write_file with package.json → MEDIUM, no confirmation for main agent', () => {
      const r = assessRisk('write_file', { path: 'package.json' }, ctx())
      expect(r).not.toBeNull()
      expect(r!.level).toBe('medium')
      expect(r!.requiresConfirmation).toBe(false)
    })

    it('write_file with package.json → MEDIUM, requires confirmation if subagent', () => {
      const r = assessRisk('write_file', { path: 'package.json' }, ctx({ isSubAgent: true }))
      expect(r).not.toBeNull()
      expect(r!.level).toBe('medium')
      expect(r!.requiresConfirmation).toBe(true)
    })

    it('write_file with tsconfig.json → MEDIUM, no confirmation for main agent', () => {
      const r = assessRisk('write_file', { path: 'tsconfig.json' }, ctx())
      expect(r).not.toBeNull()
      expect(r!.level).toBe('medium')
      expect(r!.requiresConfirmation).toBe(false)
    })

    it('write_file with tsconfig.json → MEDIUM, requires confirmation if subagent', () => {
      const r = assessRisk('write_file', { path: 'tsconfig.json' }, ctx({ isSubAgent: true }))
      expect(r).not.toBeNull()
      expect(r!.level).toBe('medium')
      expect(r!.requiresConfirmation).toBe(true)
    })

    it('write with recentWriteCount >= 3 → MEDIUM (burst)', () => {
      const r = assessRisk('write_file', { path: 'src/x.ts' }, ctx({ recentWriteCount: 3 }))
      expect(r).not.toBeNull()
      expect(r!.level).toBe('medium')
      expect(r!.matchedRule).toBe('write:burst')
    })

    it('burst → requires confirmation only if subagent', () => {
      const noConfirm = assessRisk('write_file', { path: 'src/x.ts' }, ctx({ recentWriteCount: 3 }))
      expect(noConfirm!.requiresConfirmation).toBe(false)

      const confirm = assessRisk('write_file', { path: 'src/x.ts' }, ctx({ recentWriteCount: 3, isSubAgent: true }))
      expect(confirm!.requiresConfirmation).toBe(true)
    })
  })

  describe('no match (null)', () => {
    it('git status → null', () => {
      expect(assessRisk('shell', { command: 'git status' }, ctx())).toBeNull()
    })

    it('git log --oneline → null', () => {
      expect(assessRisk('shell', { command: 'git log --oneline' }, ctx())).toBeNull()
    })

    it('ls -la → null', () => {
      expect(assessRisk('shell', { command: 'ls -la' }, ctx())).toBeNull()
    })

    it('bun test → null', () => {
      expect(assessRisk('shell', { command: 'bun test' }, ctx())).toBeNull()
    })

    it('read_file with any path → null', () => {
      expect(assessRisk('read_file', { path: '/etc/passwd' }, ctx())).toBeNull()
    })

    it('cat src/index.ts → null', () => {
      expect(assessRisk('shell', { command: 'cat src/index.ts' }, ctx())).toBeNull()
    })
  })

  describe('config overrides', () => {
    it('user override: shell:chmod with level medium → returns medium', () => {
      const config = {
        rules: [{ id: 'shell:chmod', level: 'medium' as const, tool: 'shell', pattern: 'chmod *' }],
      }
      const r = assessRisk('shell', { command: 'chmod 644 file.txt' }, ctx({ config }))
      expect(r).not.toBeNull()
      expect(r!.level).toBe('medium')
    })

    it('enabled: false → returns null for everything', () => {
      const config = { enabled: false }
      expect(assessRisk('shell', { command: 'rm -rf /' }, ctx({ config }))).toBeNull()
      expect(assessRisk('shell', { command: 'sudo reboot' }, ctx({ config }))).toBeNull()
      expect(assessRisk('write_file', { path: '.deepseek/config.json' }, ctx({ config }))).toBeNull()
    })

    it('custom threshold: largeFileLines: 200 → 150 lines does not trigger', () => {
      const config = { thresholds: { largeFileLines: 200 } }
      const r = assessRisk('write_file', { path: 'src/foo.ts', _existingLineCount: 150 }, ctx({ config }))
      // Should not match large_overwrite since 150 < 200
      // But might match burst or other rules — check it's not large_overwrite
      if (r !== null) {
        expect(r.matchedRule).not.toBe('write:large-overwrite')
      }
    })

    it('custom threshold: largeFileLines: 200 → 250 lines does trigger', () => {
      const config = { thresholds: { largeFileLines: 200 } }
      const r = assessRisk('write_file', { path: 'src/foo.ts', _existingLineCount: 250 }, ctx({ config }))
      expect(r).not.toBeNull()
      expect(r!.matchedRule).toBe('write:large-overwrite')
      expect(r!.level).toBe('high')
    })
  })

  describe('edge cases', () => {
    it('command with extra whitespace: "  rm  -rf  /" → matches HIGH', () => {
      const r = assessRisk('shell', { command: '  rm  -rf  /' }, ctx())
      expect(r).not.toBeNull()
      expect(r!.level).toBe('high')
      expect(r!.requiresConfirmation).toBe(true)
    })

    it('DEFAULT_RISK_RULES is a non-empty array', () => {
      expect(Array.isArray(DEFAULT_RISK_RULES)).toBe(true)
      expect(DEFAULT_RISK_RULES.length).toBeGreaterThan(0)
    })

    it('unknown tool returns null', () => {
      expect(assessRisk('unknown_tool', { foo: 'bar' }, ctx())).toBeNull()
    })

    it('shell with no command arg returns null', () => {
      expect(assessRisk('shell', {}, ctx())).toBeNull()
    })

    it('write_file with no path arg still checks conditions', () => {
      // large_overwrite checks _existingLineCount regardless of path
      const r = assessRisk('write_file', { _existingLineCount: 200 }, ctx())
      expect(r).not.toBeNull()
      expect(r!.matchedRule).toBe('write:large-overwrite')
    })
  })

  describe('specificity over level', () => {
    it('npm install --save-dev is MEDIUM, not HIGH', () => {
      const r = assessRisk('shell', { command: 'npm install --save-dev lodash' }, ctx())
      expect(r).not.toBeNull()
      expect(r!.level).toBe('medium')
      expect(r!.matchedRule).toBe('shell:npm-install-dev')
    })

    it('bun add -d is MEDIUM, not HIGH', () => {
      const r = assessRisk('shell', { command: 'bun add -d vitest' }, ctx())
      expect(r).not.toBeNull()
      expect(r!.level).toBe('medium')
      expect(r!.matchedRule).toBe('shell:bun-add-dev')
    })

    it('npm install lodash (without --save-dev) is still HIGH', () => {
      const r = assessRisk('shell', { command: 'npm install lodash' }, ctx())
      expect(r).not.toBeNull()
      expect(r!.level).toBe('high')
      expect(r!.matchedRule).toBe('shell:npm-install')
    })
  })

  describe('false positive fixes', () => {
    it('cat deploy-notes.md is NOT high risk', () => {
      const r = assessRisk('shell', { command: 'cat deploy-notes.md' }, ctx())
      expect(r).toBeNull()
    })

    it('git push --follow-tags is MEDIUM (not HIGH force push)', () => {
      const r = assessRisk('shell', { command: 'git push --follow-tags' }, ctx())
      expect(r).not.toBeNull()
      expect(r!.level).toBe('medium')
      expect(r!.matchedRule).toBe('shell:git-push')
    })

    it('git push -f is still HIGH', () => {
      const r = assessRisk('shell', { command: 'git push -f origin main' }, ctx())
      expect(r).not.toBeNull()
      expect(r!.level).toBe('high')
    })
  })
})
