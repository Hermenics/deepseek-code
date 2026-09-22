import { readFile } from 'node:fs/promises'
import type { CommandResult } from '../commands/types.js'
import { discoverWorkflows, type DiscoveredWorkflow } from './discovery.js'

let cached = new Map<string, DiscoveredWorkflow>()

/** Rediscovers workflows for `cwd` and replaces the module-level cache read by the suggestion and description getters. */
export async function refreshWorkflowCommands(cwd: string): Promise<void> {
  cached = new Map((await discoverWorkflows(cwd)).map(workflow => [workflow.meta.name, workflow]))
}

/** Slash-command names of the cached workflows; empty until refreshWorkflowCommands has run. */
export function getWorkflowCommandSuggestions(): string[] {
  return [...cached.keys()].map(name => `/${name}`)
}

/** Maps each cached workflow slash command to its description, with a generic fallback. */
export function getWorkflowCommandDescriptions(): Record<string, string> {
  return Object.fromEntries([...cached.values()].map(workflow => [`/${workflow.meta.name}`, workflow.meta.description ?? 'Saved Dynamic Workflow']))
}

/** Turns `/name args` into a workflow run command when a saved workflow of that name exists; returns null otherwise so other command handlers can claim the input. */
export async function resolveWorkflowCommand(input: string, cwd: string): Promise<CommandResult | null> {
  const match = /^\/([a-z0-9][a-z0-9-]{0,63})(?:\s+([\s\S]*))?$/.exec(input.trim())
  if (!match) return null
  await refreshWorkflowCommands(cwd)
  if (!cached.has(match[1]!)) return null
  return { type: 'workflow', action: 'run', name: match[1]!, args: match[2] }
}

/** Returns a saved workflow's source by name after refreshing discovery; throws when it does not exist. */
export async function readSavedWorkflow(name: string, cwd: string): Promise<string> {
  await refreshWorkflowCommands(cwd)
  const workflow = cached.get(name)
  if (!workflow) throw new Error(`Workflow '${name}' not found`)
  return readFile(workflow.path, 'utf8')
}
