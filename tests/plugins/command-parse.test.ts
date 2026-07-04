import { describe, it, expect } from 'bun:test'
import { parsePluginCommand } from '../../src/commands/plugin/index.js'

describe('parsePluginCommand', () => {
  describe('install', () => {
    it('should parse install with valid owner/repo', () => {
      const result = parsePluginCommand(['install', 'owner/repo'])
      expect(result).toEqual({ type: 'plugin', action: 'install', repo: 'owner/repo' })
    })

    it('should parse install with dots and underscores in repo', () => {
      const result = parsePluginCommand(['install', 'my.org/my_plugin'])
      expect(result).toEqual({ type: 'plugin', action: 'install', repo: 'my.org/my_plugin' })
    })

    it('should return error when install has no repo', () => {
      const result = parsePluginCommand(['install'])
      expect(result).toHaveProperty('action', 'error')
    })

    it('should return error for invalid repo format (no slash)', () => {
      const result = parsePluginCommand(['install', 'invalid'])
      expect(result).toHaveProperty('action', 'error')
    })
  })

  describe('list', () => {
    it('should parse list command', () => {
      const result = parsePluginCommand(['list'])
      expect(result).toEqual({ type: 'plugin', action: 'list' })
    })
  })

  describe('remove', () => {
    it('should parse remove with valid name', () => {
      const result = parsePluginCommand(['remove', 'my-plugin'])
      expect(result).toEqual({ type: 'plugin', action: 'remove', name: 'my-plugin' })
    })

    it('should return error when remove has no name', () => {
      const result = parsePluginCommand(['remove'])
      expect(result).toHaveProperty('action', 'error')
    })

    it('should return error for invalid name (uppercase)', () => {
      const result = parsePluginCommand(['remove', 'UPPER'])
      expect(result).toHaveProperty('action', 'error')
    })
  })

  describe('update', () => {
    it('should parse update with valid name', () => {
      const result = parsePluginCommand(['update', 'my-plugin'])
      expect(result).toEqual({ type: 'plugin', action: 'update', name: 'my-plugin' })
    })

    it('should return error when update has no name', () => {
      const result = parsePluginCommand(['update'])
      expect(result).toHaveProperty('action', 'error')
    })
  })

  describe('help / no args', () => {
    it('should return help when no args given', () => {
      const result = parsePluginCommand([])
      expect(result).toEqual({ type: 'plugin', action: 'help' })
    })

    it('should return help for unknown subcommand', () => {
      const result = parsePluginCommand(['foobar'])
      expect(result).toHaveProperty('action', 'help')
    })
  })
})
