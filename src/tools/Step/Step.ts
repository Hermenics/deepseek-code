import type { Tool } from '../types.js'

/** Names the next group of tool calls for the user: `active` shows while it runs, `done` once the next step opens or the turn ends. The runtime announces it before the batch runs. */
export const Step: Tool = {
  name: 'step',
  description: `Open a named step: the group of tool calls that follows, shown to the user as one bold heading. Plan your steps before your first tool call (for example: investigate, change, verify), then open each step in the SAME response as its first tool calls. The step stays open across responses until you open the next one or finish the turn.
- active: present continuous, shown while the step runs ("Running the tests", "Rodando os testes")
- done: simple past, shown after it ends ("Ran the tests", "Rodou os testes")
Both at most 6 words, in the user's language, naming the purpose, not the tool, with no trailing period or ellipsis (the UI animates its own dots). At most one step per response. Skip steps for a turn with a single trivial tool call.`,
  parameters: {
    type: 'object',
    properties: {
      active: { type: 'string', description: 'Present continuous label shown while the step runs' },
      done: { type: 'string', description: 'Simple past label shown after the step ends' },
    },
    required: ['active', 'done'],
  },
  async execute(args) {
    const { active, done } = args as { active?: unknown; done?: unknown }
    if (typeof active !== 'string' || !active.trim() || typeof done !== 'string' || !done.trim()) return 'Error: active and done are required non-empty strings'
    return `Step opened: ${active.trim()}`
  },
}
