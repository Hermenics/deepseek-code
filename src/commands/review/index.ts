import type { Command } from '../types.js'

const command: Command = {
  name: 'review',
  aliases: [],
  description: 'Review project code or a specific file',
  parse(args) {
    return { type: 'review', target: args.join(' ') }
  },
}

export const REVIEW_PROMPT = (target: string) => `You are a senior code reviewer. Perform a thorough review of ${target ? `the file/module: ${target}` : 'code recently modified in this project'}.

Analyze and report:
1. **Bugs and logic issues** — real or potential errors
2. **Quality and readability** — confusing code, bad names, duplication
3. **Performance** — unnecessary operations, inefficient loops
4. **Security** — unvalidated inputs, data exposure
5. **Suggested improvements** — refactors worth doing

For each issue found, show the problematic snippet and the suggested fix. Be direct and objective.`

export default command
