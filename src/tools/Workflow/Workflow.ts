import type { Tool } from '../types.js'

export const Workflow: Tool = {
  name: 'workflow',
  description: `Execute a bounded Dynamic Workflow JavaScript program. The program must start with export const meta = {"name":"lowercase-name","description":"...","phases":[{"title":"Scan","detail":"what this phase does"}]}; and may use agent(prompt, options), parallel(thunks), pipeline(items, ...stages), workflow(name, args), args, budget, log(value), phase(value), top-level await, and top-level return. Declare one meta.phases entry per phase(value) call and use the same titles, so the monitor can show phases before they start. Always pass a short options.label (for example "scan:auth") to every agent(), because that label is the agent's name in the monitor. Use this for multi-stage work that benefits from parallel specialist agents. Writer agents are isolated in Git worktrees.`,
  parameters: {
    type: 'object', additionalProperties: false,
    properties: {
      script: { type: 'string', minLength: 1, description: 'Complete JavaScript workflow source.' },
      name: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{0,63}$', description: 'Fallback name for ad-hoc scripts without metadata.' },
      args: { description: 'JSON-serializable workflow arguments.' },
      timeoutMs: { type: 'number', minimum: 1, maximum: 3_600_000 },
      maxTokens: { type: 'number', minimum: 1 },
      maxCostUsd: { type: 'number', minimum: 0 },
    },
    required: ['script'],
  },
  async execute(args, context) {
    if (!context?.workflowManager) throw new Error('Workflow manager is unavailable')
    const handle = await context.workflowManager.start({
      script: args.script as string,
      name: args.name as string | undefined,
      args: args.args,
      timeoutMs: args.timeoutMs as number | undefined,
      maxTokens: args.maxTokens as number | undefined,
      maxCostUsd: args.maxCostUsd as number | undefined,
    })
    const onAbort = () => handle.cancel(context.signal?.reason instanceof Error ? context.signal.reason.message : undefined)
    context.signal?.addEventListener('abort', onAbort, { once: true })
    if (context.signal?.aborted) onAbort()
    try { return JSON.stringify(await handle.result) }
    finally { context.signal?.removeEventListener('abort', onAbort) }
  },
}
