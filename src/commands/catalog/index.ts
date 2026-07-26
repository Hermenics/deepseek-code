import type { Command, CommandResult } from '../types.js'

export function parseCatalogCommand(args: string[]): CommandResult {
  const kind = args[0]?.toUpperCase()
  if (!kind) return { type: 'catalog' }
  if (kind === 'MCP' || kind === 'PLUGIN' || kind === 'SKILL') {
    return { type: 'catalog', kind: kind === 'PLUGIN' ? 'Plugin' : kind === 'SKILL' ? 'Skill' : 'MCP' }
  }
  return { type: 'unknown', input: 'Usage: /catalog [mcp|plugin|skill]' }
}

const command: Command = {
  name: 'catalog',
  aliases: ['marketplace'],
  description: 'Show curated MCP, plugin and skill recommendations',
  parse(args) {
    return parseCatalogCommand(args)
  },
}

export default command
