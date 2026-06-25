import type { Command } from '../types.js'

const command: Command = {
  name: 'effort',
  aliases: [],
  description: 'Set reasoning effort level',
  parse(args) {
    const level = args[0]?.toLowerCase()
    if (!level) return { type: 'effort', action: 'status' }
    if (level === 'status' || level === 'current') return { type: 'effort', action: 'status' }
    if (level === 'auto' || level === 'unset') return { type: 'effort', action: 'set', level: 'high' }
    if (['low', 'medium', 'high', 'max'].includes(level)) {
      return { type: 'effort', action: 'set', level: level as 'low' | 'medium' | 'high' | 'max' }
    }
    return { type: 'unknown', input: `Invalid effort level: "${level}". Use: /effort [low|medium|high|max|auto]` }
  },
}

export default command
