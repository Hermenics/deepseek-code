import { Tool } from '../types.js'
import { randomUUID } from 'node:crypto'
import type { ProviderConfig } from '../../types/provider.js'
import { defaultModel } from '../../agent/llmClient.js'
import { runSubAgentLoop } from './executor.js'
import { acquire, release, setConcurrencyLimit } from './concurrency.js'
import { parseSubAgentResult, formatResultForParent, type SubAgentResult } from './contracts.js'
import { getToolsForRole, inferRole, describeRole, type SubAgentRole } from './permissions.js'
import { getCurrentMemory, addPreviousResult, formatMemoryForPrompt } from './memory.js'
import { shouldVerify, buildVerifierPrompt, parseVerificationResult, formatVerificationForUser } from './verification.js'
import { composeSubAgentPrompt, loadAgentConfig, type AgentConfig } from '../../agent/config.js'
import { loadMergedSettings } from '../../settings/loader.js'

// Provider config and model inherited from the parent Agent
let subAgentProvider: ProviderConfig = { provider: 'deepseek' }
let subAgentModel: string | null = null

export function setSubAgentProvider(cfg: ProviderConfig) {
  subAgentProvider = cfg
}

export function setSubAgentModel(model: string) {
  subAgentModel = model
}

export interface SubAgentCallbacks {
  onStart(id: string, task: string, agentName?: string): void
  onToolUse(id: string, tool: string, info?: string): void
  onDone(id: string, result: string, tokens?: number, costUsd?: number, structured?: SubAgentResult): void
  onError(id: string, error: string): void
}

// Cost per million tokens (input+output averaged) by model prefix
const COST_PER_M_TOKENS: Record<string, number> = {
  'deepseek-v4-flash': 0.21,   // avg of $0.14 input + $0.28 output
  'deepseek-v4-pro': 0.65,     // avg of $0.435 input + $0.87 output
  'deepseek-chat': 0.21,       // deprecated alias → v4-flash
  'deepseek-reasoner': 0.21,   // deprecated alias → v4-flash
  'deepseek-v4': 0.21,         // prefix fallback
  'gpt-4o': 7.5,
  'gpt-4': 30.0,
  'gpt-3.5': 0.75,
  'claude-opus': 45.0,
  'claude-sonnet': 9.0,
  'claude-haiku': 0.75,
}

function estimateCost(model: string, totalTokens: number): number {
  const key = Object.keys(COST_PER_M_TOKENS).find(k => model.startsWith(k))
  const rate = key ? COST_PER_M_TOKENS[key]! : 1.0 // fallback $1/M
  return (totalTokens / 1_000_000) * rate
}

let subAgentCallbacks: SubAgentCallbacks | null = null

export function setSubAgentCallbacks(cb: SubAgentCallbacks | null) {
  subAgentCallbacks = cb
}

export const SubAgent: Tool = {
  name: 'subagent',
  description: 'Spawn a specialized subagent to handle a focused subtask independently. Supports specialist agents (coder, reviewer, tester) with domain expertise, or generic subagents with role-based tool access. Multiple subagent calls in the same response are executed in parallel. Returns the subagent\'s final result.',
  parameters: {
    type: 'object',
    properties: {
      task: {
        type: 'string',
        description: 'The specific task for the subagent. Be precise: include file paths, expected output format, and any constraints.',
      },
      model: {
        type: 'string',
        description: 'Optional model override (e.g. "deepseek-reasoner" for complex reasoning tasks). Defaults to the parent model.',
      },
      role: {
        type: 'string',
        enum: ['reader', 'writer', 'executor', 'reviewer', 'unrestricted'],
        description: 'Permission role controlling which tools the subagent can use. Defaults to auto-inferred from task.',
      },
      verify: {
        type: 'boolean',
        description: 'If true, spawn a verifier subagent to check the result. Auto-enabled for file changes and low confidence.',
      },
      agent: {
        type: 'string',
        description: 'Agent name from the active registry. Built-ins include coder, reviewer, and tester.',
      },
    },
    required: ['task'],
  },
  async execute(args) {
    const task = args.task as string
    const modelOverride = args.model as string | undefined
    const agentId = randomUUID().slice(0, 8)
    const agentArg = args.agent as string | undefined

    // Snapshot provider/model at invocation time to avoid race with parallel subagents
    const provider = subAgentProvider
    const settings = await loadMergedSettings()
    setConcurrencyLimit(settings.agents?.concurrency ?? 5)
    let selected: AgentConfig | null = null
    if (agentArg) {
      const loaded = await loadAgentConfig(agentArg)
      if (!['subagent', 'both'].includes(loaded.config.usage ?? 'primary')) {
        return `Error: agent '${agentArg}' is not enabled for subagent use.`
      }
      selected = loaded.config
    }
    const role: SubAgentRole = selected?.role ?? (args.role as SubAgentRole) ?? inferRole(task)
    const agentName = selected?.name
    const modelSettings = typeof settings.model === 'object' ? settings.model : undefined
    const modelName = modelOverride ?? selected?.model ?? settings.agents?.subagentModel ?? modelSettings?.subagent ?? subAgentModel ?? defaultModel(provider.provider)

    await acquire()
    subAgentCallbacks?.onStart(agentId, task, agentName)

    try {
      // Lazy import to avoid circular dependency
      const { allTools } = await import('../index.js')
      const subagentTools = allTools.filter((t) => t.name !== 'subagent' && t.name !== 'ask_agent')

      // Filter tools by role
      let filteredTools = getToolsForRole(role, subagentTools)
      if (Array.isArray(selected?.tools)) filteredTools = filteredTools.filter(tool => selected!.tools!.includes(tool.name))

      const memory = formatMemoryForPrompt(getCurrentMemory())
      const specialization: AgentConfig = selected ?? {
        name: 'generic', usage: 'subagent', role,
        systemPrompt: `Role: ${role} — ${describeRole(role)}`,
      }
      const prompt = composeSubAgentPrompt(
        specialization,
        settings.agents?.basePrompt ?? 'You are a specialized subagent of DeepSeek Code. Work only on the delegated task and return a direct result.',
        task,
        memory,
      )

      const { resultText, totalTokens } = await runSubAgentLoop(
        prompt, task, agentId, filteredTools, provider, modelName,
        {
          onToolUse: (id, tool, info) => subAgentCallbacks?.onToolUse(id, tool, info),
          permissionPolicy: selected?.permissions?.policy ?? settings.agents?.permissionPolicy,
          permissions: selected?.permissions,
        },
      )

      // Parse structured result
      const structured = parseSubAgentResult(resultText)

      // Add to task memory for sibling subagents
      addPreviousResult(getCurrentMemory(), task, structured.summary, structured.confidence)

      // Verification check (reuses current concurrency slot — no second acquire)
      let verificationSuffix = ''
      if (shouldVerify(task, structured, args.verify as boolean | undefined)) {
        const verifierPrompt = buildVerifierPrompt(task, structured)
        let verifierTools = getToolsForRole('reader', subagentTools)
        if (Array.isArray(selected?.tools)) verifierTools = verifierTools.filter(tool => selected!.tools!.includes(tool.name))
        const { resultText: verifierText } = await runSubAgentLoop(
          verifierPrompt, verifierPrompt, `${agentId}-v`, verifierTools, provider, modelName,
          {
            onToolUse: (id, tool, info) => subAgentCallbacks?.onToolUse(id, tool, info),
            permissionPolicy: selected?.permissions?.policy ?? settings.agents?.permissionPolicy,
            permissions: selected?.permissions,
          },
        )
        const verification = parseVerificationResult(verifierText)
        verificationSuffix = `\n${formatVerificationForUser(verification)}`
      }

      const formattedResult = formatResultForParent(structured) + verificationSuffix
      const cost = totalTokens > 0 ? estimateCost(modelName, totalTokens) : undefined
      subAgentCallbacks?.onDone(agentId, formattedResult.slice(0, 200), totalTokens || undefined, cost, structured)
      return formattedResult
    } catch (e: unknown) {
      const errMsg = (e as Error).message ?? String(e)
      subAgentCallbacks?.onError(agentId, errMsg)
      throw e
    } finally {
      release()
    }
  },
}
