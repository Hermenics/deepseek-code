import { describe, expect, it } from 'bun:test'
import { formatPermissionsReport } from '../src/permissions/explain.js'

describe('formatPermissionsReport', () => {
  it('explains mode, settings rules, risk checks and session approvals', () => {
    const report = formatPermissionsReport({
      mode: 'build',
      allowedTools: ['read_file', 'shell'],
      sessionApproved: ['risk:shell:rm:rm -rf tmp'],
      modeTools: ['shell', 'read_file'],
      permissions: {
        allow: ['Shell(git *)'],
        deny: ['WriteFile(*.env)'],
      },
      risk: {
        thresholds: { largeFileLines: 200, burstCount: 5 },
      },
    })

    expect(report).toContain('**Current mode:** build')
    expect(report).toContain('**Tools allowed in mode:** read_file, shell')
    expect(report).toContain('**Agent allowlist:** read_file, shell')
    expect(report).toContain('**Settings allow rules:** Shell(git *)')
    expect(report).toContain('**Settings deny rules:** WriteFile(*.env)')
    expect(report).toContain('large overwrite >= 200 lines')
    expect(report).toContain('write burst >= 5 writes')
    expect(report).toContain('risk:shell:rm:rm -rf tmp')
    expect(report).toContain('Decision order:')
  })

  it('shows disabled risk checks explicitly', () => {
    const report = formatPermissionsReport({
      mode: 'plan',
      allowedTools: null,
      sessionApproved: [],
      risk: { enabled: false },
    })

    expect(report).toContain('**Risk checks:** disabled')
    expect(report).toContain('**Approved this session:** none')
  })

  it('does not mutate report input arrays while sorting display values', () => {
    const allowedTools = ['shell', 'read_file']
    const allow = ['Shell(git *)', 'ReadFile']
    const deny = ['WriteFile(*.env)', 'Shell(rm *)']
    const sessionApproved = ['z', 'a']

    formatPermissionsReport({
      mode: 'build',
      allowedTools,
      sessionApproved,
      permissions: { allow, deny },
    })

    expect(allowedTools).toEqual(['shell', 'read_file'])
    expect(allow).toEqual(['Shell(git *)', 'ReadFile'])
    expect(deny).toEqual(['WriteFile(*.env)', 'Shell(rm *)'])
    expect(sessionApproved).toEqual(['z', 'a'])
  })
})
