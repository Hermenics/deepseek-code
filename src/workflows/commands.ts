import { readFile } from 'node:fs/promises'
import type { CommandResult } from '../commands/types.js'
import { discoverWorkflows, type DiscoveredWorkflow } from './discovery.js'

let cached = new Map<string, DiscoveredWorkflow>()

export async function refreshWorkflowCommands(cwd: string): Promise<void> {
  cached = new Map((await discoverWorkflows(cwd)).map(workflow => [workflow.meta.name, workflow]))
}

export function getWorkflowCommandSuggestions(): string[] {
  return [...cached.keys()].map(name => `/${name}`)
}

export function getWorkflowCommandDescriptions(): Record<string, string> {
  return Object.fromEntries([...cached.values()].map(workflow => [`/${workflow.meta.name}`, workflow.meta.description ?? 'Saved Dynamic Workflow']))
}

export async function resolveWorkflowCommand(input: string, cwd: string): Promise<CommandResult | null> {
  const match = /^\/([a-z0-9][a-z0-9-]{0,63})(?:\s+([\s\S]*))?$/.exec(input.trim())
  if (!match) return null
  await refreshWorkflowCommands(cwd)
  if (!cached.has(match[1]!)) return null
  return { type: 'workflow', action: 'run', name: match[1]!, args: match[2] }
}

export async function readSavedWorkflow(name: string, cwd: string): Promise<string> {
  await refreshWorkflowCommands(cwd)
  const workflow = cached.get(name)
  if (!workflow) throw new Error(`Workflow '${name}' not found`)
  return readFile(workflow.path, 'utf8')
}
