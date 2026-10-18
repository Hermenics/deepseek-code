import { describe, expect, it } from 'bun:test'
import { resolvePermission } from '../src/permissions/matcher.js'

describe('default capability permissions', () => {
  it('asks before shell and network tools when no rule is configured', () => {
    expect(resolvePermission(undefined, 'shell', { command: 'git status' })).toBe('ask')
    expect(resolvePermission(undefined, 'web_fetch', { url: 'https://example.invalid' })).toBe('ask')
  })

  it('keeps ordinary read tools allowed by default', () => {
    expect(resolvePermission(undefined, 'read_file', { path: 'src/index.ts' })).toBe('allow')
  })

  it('checks every file in a batched read', () => {
    const permissions = { deny: ['read_file(secret.txt)'] }
    expect(resolvePermission(permissions, 'read_file', { paths: ['src/index.ts', 'secret.txt'] })).toBe('deny')
  })

  it('checks every directory in a batched listing', () => {
    const permissions = { deny: ['read_folder(secret/)'] }
    expect(resolvePermission(permissions, 'read_folder', { paths: ['src/', 'secret/'] })).toBe('deny')
  })

  it('honors explicit allow and deny rules for shell commands', () => {
    expect(resolvePermission({ allow: ['Shell(git status)'] }, 'shell', { command: 'git status' })).toBe('allow')
    expect(resolvePermission({ deny: ['Shell(curl *)'] }, 'shell', { command: 'curl https://example.invalid' })).toBe('deny')
    expect(resolvePermission({ deny: ['Shell(curl *)'] }, 'shell', { command: 'git status' })).toBe('ask')
  })

  it('matches documented PascalCase aliases to snake_case tool names', () => {
    expect(resolvePermission({ deny: ['WriteFile(*)'] }, 'write_file', { path: 'secret.txt' })).toBe('deny')
    expect(resolvePermission({ allow: ['ReadFile(src/*)'] }, 'read_file', { path: 'src/index.ts' })).toBe('allow')
    expect(resolvePermission({ deny: ['MoA'] }, 'moa', {})).toBe('deny')
  })
})
