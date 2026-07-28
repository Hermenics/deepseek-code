import type { Command } from '../types.js'

const goalCommand: Command = {
  name: 'goal',
  aliases: [],
  description: 'Set, view, or manage a persistent goal. Usage: /goal [<objective> [--turns <n>]]',
  parse(args: string[]) {
    if (args.length === 0) return { type: 'goal', action: 'show' }

    const sub = args[0].toLowerCase()

    if (sub === 'edit') return { type: 'goal', action: 'edit' }
    if (sub === 'pause') return { type: 'goal', action: 'pause' }
    if (sub === 'resume') return { type: 'goal', action: 'resume' }
    if (sub === 'clear') return { type: 'goal', action: 'clear' }

    // Parse --turns flag (can be anywhere in args)
    const turnsIdx = args.indexOf('--turns')
    let maxContinuations: number | undefined
    if (turnsIdx !== -1 && turnsIdx + 1 < args.length) {
      maxContinuations = parseInt(args[turnsIdx + 1], 10)
      if (isNaN(maxContinuations) || maxContinuations <= 0) maxContinuations = undefined
    }

    // Everything except --turns and its value is the objective
    const objective = turnsIdx === -1
      ? args.join(' ').trim()
      : args.filter((_, i) => i !== turnsIdx && i !== turnsIdx + 1).join(' ').trim()

    return { type: 'goal', action: 'set', objective, maxContinuations }
  },
}

export default goalCommand
