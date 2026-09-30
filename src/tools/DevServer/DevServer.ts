import { Tool } from '../types.js'
import type { ToolExecutionContext } from '../../orchestration/types.js'
import { isEnabled, loadFeatures } from '../../features.js'
import { devServers, launchCommand, launchHash, readLaunchConfigs, type LaunchConfig } from '../../browser/devServer.js'

export const DevServer: Tool = {
  name: 'dev_server',
  description: [
    'Start, inspect and stop the project\'s dev servers declared in .deepseek/launch.json or .claude/launch.json ({"configurations": [{"name", "runtimeExecutable", "runtimeArgs", "port", "cwd?", "env?"}]}).',
    'Use it instead of shell for long-running servers: shell blocks until exit and has no network. start {name?} waits until the port answers and returns the URL (open it with the browser tool); logs {name, lines?, filter?} shows recent output; stop {name}; list.',
    'If there is no launch.json, ask the user to add one; you cannot write it. Starting a server needs the user\'s approval, and again whenever its entry changes.',
  ].join('\n'),
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['start', 'stop', 'logs', 'list'] },
      name: { type: 'string', description: 'Configuration name; start may omit it when there is only one' },
      lines: { type: 'number', description: 'logs: how many recent lines (default 40, max 500)' },
      filter: { type: 'string', description: 'logs: only lines containing this text' },
    },
    required: ['action'],
  },

  async execute(args, context) {
    if (!isEnabled('browser', loadFeatures())) return 'Error: dev servers come with the browser feature, which is off. The user can turn it on with /features browser on.'
    return runDevServer(args, context)
  },
}

/** The configuration a call targets: by name, or the only one. */
export function pickConfig(configs: LaunchConfig[], name: unknown): LaunchConfig | string {
  if (typeof name === 'string' && name) return configs.find(config => config.name === name) ?? `no configuration named "${name}" (have: ${configs.map(c => c.name).join(', ')})`
  if (configs.length === 1) return configs[0]!
  return `name is required: ${configs.map(c => c.name).join(', ')}`
}

export async function runDevServer(args: Record<string, unknown>, context?: ToolExecutionContext): Promise<string> {
  if (context?.taskId) return 'Error: subagents cannot manage dev servers; report back and let the main agent do it.'
  const root = context?.projectRoot ?? process.cwd()
  const owner = context?.sessionId ?? 'default'
  const action = String(args.action ?? '')
  const { configs, source, error } = await readLaunchConfigs(root)

  if (action === 'list') {
    if (error) return `Error: ${error}`
    if (!source) return 'No .deepseek/launch.json or .claude/launch.json in this project.'
    return [`From ${source}:`, ...configs.map(config => {
      const server = devServers.get(root, config.name)
      const state = !server ? 'stopped' : server.exitCode === null ? `running (pid ${server.proc.pid})` : `exited with code ${server.exitCode}`
      return `- ${config.name}: ${launchCommand(config)} → http://localhost:${config.port} · ${state}`
    })].join('\n')
  }

  if (action === 'logs' || action === 'stop') {
    const running = devServers.list(root)
    const name = typeof args.name === 'string' && args.name ? args.name : running.length === 1 ? running[0]!.config.name : ''
    const server = name ? devServers.get(root, name) : undefined
    if (!server) return `Error: ${name ? `${name} was not started by dev_server` : 'name is required'}${running.length ? ` (running: ${running.map(s => s.config.name).join(', ')})` : ''}`
    if (action === 'stop') {
      await devServers.stop(root, name)
      return `Stopped ${name}.`
    }
    const lines = Math.min(Math.max(Math.trunc(Number(args.lines) || 40), 1), 500)
    const state = server.exitCode === null ? 'running' : `exited with code ${server.exitCode}`
    return `${name} (${state}), last ${lines} lines${args.filter ? ` matching "${args.filter}"` : ''}:\n${devServers.tail(server, lines, typeof args.filter === 'string' ? args.filter : undefined)}`
  }

  if (action === 'start') {
    if (error) return `Error: ${error}`
    if (!source) return 'Error: no .deepseek/launch.json or .claude/launch.json in this project. Ask the user to create one.'
    const config = pickConfig(configs, args.name)
    if (typeof config === 'string') return `Error: ${config}`
    // The user approved the entry the agent resolved before asking (`__launch`); refuse if it changed since.
    if (args.__launch !== launchHash(config)) return `Error: ${config.name} in ${config.source} changed after it was approved; call start again to re-approve.`
    return devServers.start(root, config, owner, context?.signal)
  }
  return `Error: unknown action "${action}"`
}

/**
 * Arguments as the permission gates see them: for `start`, the resolved entry's hash (`__launch`, what an
 * approval covers) and its command line (`__command`, what the prompt shows). Model-supplied `__` keys are dropped.
 */
export async function withLaunchApproval(root: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const rest = Object.fromEntries(Object.entries(args).filter(([key]) => !key.startsWith('__')))
  if (rest.action !== 'start') return rest
  const { configs } = await readLaunchConfigs(root)
  const config = pickConfig(configs, rest.name)
  if (typeof config === 'string') return rest
  return { ...rest, __launch: launchHash(config), __command: `${launchCommand(config)}  (${config.name}, port ${config.port}, from ${config.source})` }
}
