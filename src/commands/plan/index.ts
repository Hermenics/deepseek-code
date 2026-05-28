import type { Command } from '../types.js'

const command: Command = {
  name: 'plan',
  aliases: [],
  description: 'Plan implementation of a task',
  parse(args) {
    const task = args.join(' ')
    if (!task) return { type: 'unknown', input: 'Usage: /plan <task>' }
    return { type: 'plan', task }
  },
}

export const PLAN_PROMPT = (task: string) => `You are a senior software architect. Analyze the current codebase and create a detailed implementation plan for the following task:

**Task:** ${task}

Your plan must include:
1. **Understanding** — what needs to be done and why
2. **Affected files** — which files to create, modify, or remove
3. **Implementation steps** — ordered, actionable steps
4. **Risks and mitigations** — what could go wrong and how to prevent it
5. **Acceptance criteria** — how to know it's done

Explore the codebase before responding. Be precise, direct, and actionable.`

export default command
