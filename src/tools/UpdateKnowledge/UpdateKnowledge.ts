import { Tool } from '../types.js'
import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'

const DEEPSEEK_MD = join(process.cwd(), 'DEEPSEEK.md')

export const UpdateKnowledge: Tool = {
  name: 'update_knowledge',
  description:
    'Record new project-specific knowledge in DEEPSEEK.md for future sessions. ' +
    'Call this when you discover important information about the project: architecture decisions, ' +
    'coding conventions, recurring patterns, solutions to tricky problems, or anything that would ' +
    'help a future agent session hit the ground running. ' +
    'Use a clear section name like "Architecture", "Conventions", "Known Issues", "Patterns", etc.',
  parameters: {
    type: 'object',
    properties: {
      section: {
        type: 'string',
        description: 'Section heading (e.g. "Architecture", "Conventions", "Known Issues")',
      },
      content: {
        type: 'string',
        description: 'The knowledge to record under this section',
      },
    },
    required: ['section', 'content'],
  },
  async execute(args) {
    const section = (args.section as string).trim()
    const content = (args.content as string).trim()

    let existing = ''
    try {
      existing = await readFile(DEEPSEEK_MD, 'utf-8')
    } catch {
      // File doesn't exist yet — start fresh
    }

    const heading = `## ${section}`
    const newBlock = `${heading}\n\n${content}`

    let updated: string
    if (existing.includes(heading)) {
      // Replace existing section (up to next ## or end of file)
      updated = existing.replace(
        new RegExp(`${escapeRegex(heading)}[\\s\\S]*?(?=\\n## |$)`),
        newBlock + '\n',
      )
    } else {
      // Append new section
      updated = existing
        ? `${existing.trimEnd()}\n\n${newBlock}\n`
        : `# DEEPSEEK.md — Project Knowledge\n\n${newBlock}\n`
    }

    await writeFile(DEEPSEEK_MD, updated, 'utf-8')
    return `Knowledge updated: "${section}"`
  },
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
