import { describe, expect, it } from 'bun:test'
import { HELP_TEXT } from '../src/commands/index.js'
import { Introspect } from '../src/tools/Introspect/Introspect.js'
import { allTools } from '../src/tools/index.js'

describe('Introspect', () => {
  it('documents the active command registry, native tools, and product subsystems', async () => {
    const docs = await Introspect.execute({})

    expect(docs).toContain(HELP_TEXT)
    for (const tool of allTools) expect(docs).toContain(`\`${tool.name}\``)
    for (const section of [
      '## Settings, scopes, and precedence',
      '## Interaction Modes',
      '## Extensions: skills, plugins, and catalog',
      '## Subagents',
      '## Project instructions and knowledge',
      '## Context management, refinement, and audit trail',
      '## Hooks',
      '## Language-server navigation',
      '## MCP Servers',
      '## Dynamic Workflows and isolated worktrees',
      '## CLI Usage',
    ]) expect(docs).toContain(section)

    expect(docs).not.toContain('/language')
    expect(docs).not.toContain('/theme')
  })
})
