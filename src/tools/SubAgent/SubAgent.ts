import { Tool } from '../types.js'
import { randomUUID } from 'node:crypto'
import type { ProviderConfig } from '../../types/provider.js'
import { defaultModel } from '../../agent/llmClient.js'
import { runSubAgentLoop } from './executor.js'
import { isFixedAgent, getFixedAgent, buildFixedAgentPrompt, type FixedAgentName } from './fixedAgents.js'
import { acquire, release } from './concurrency.js'
import { parseSubAgentResult, formatResultForParent, type SubAgentResult } from './contracts.js'
import { getToolsForRole, inferRole, describeRole, type SubAgentRole } from './permissions.js'
import { getCurrentMemory, addPreviousResult, formatMemoryForPrompt } from './memory.js'
import { shouldVerify, buildVerifierPrompt, parseVerificationResult, formatVerificationForUser } from './verification.js'

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

function buildSubAgentPrompt(task: string, role: SubAgentRole): string {
  const cwd = process.cwd()
  const roleDesc = describeRole(role)
  const memory = formatMemoryForPrompt(getCurrentMemory())

  const memorySection = memory ? `\n\n${memory}` : ''

  return `You are a specialized subagent of DeepSeek Code, spawned to handle a focused subtask.

## Context
- Working directory: ${cwd}
- You are operating independently with your own context window
- The parent agent has delegated this specific task to you
- Role: ${role} — ${roleDesc}${memorySection}

## Your Task
${task}

## Behavior
1. ANALYZE: Understand exactly what is being asked
2. PLAN: Identify which files/commands you need to read or run first
3. EXECUTE: Carry out the task step by step using the available tools
4. RETURN: Respond with only the result — no preamble, no summary of what you did

## Rules
- Be precise and focused — do only what the task asks
- Read relevant files before making changes
- If the task is ambiguous, make a reasonable assumption and state it briefly
- Return the final result directly

## Output Format
After completing your task, end your response with a JSON block:
\`\`\`json
{
  "summary": "1-2 sentence result",
  "confidence": 0.0-1.0,
  "filesRead": ["path1", "path2"],
  "filesChanged": ["path3"],
  "issuesFound": ["issue1"],
  "suggestions": ["suggestion1"],
  "metadata": {}
}
\`\`\``
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
        enum: ['coder', 'reviewer', 'tester'],
        description: 'Invoke a specialist agent with domain expertise. "coder" for implementation, "reviewer" for code review, "tester" for test writing. Uses their specialized system prompt and appropriate tool access.',
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
    const modelName = modelOverride ?? subAgentModel ?? defaultModel(provider.provider)

    // Determine if this is a fixed agent call
    const fixedAgent = agentArg && isFixedAgent(agentArg) ? getFixedAgent(agentArg as FixedAgentName) : null
    const role: SubAgentRole = fixedAgent?.role ?? (args.role as SubAgentRole) ?? inferRole(task)
    const agentName = fixedAgent?.displayName ?? undefined

    subAgentCallbacks?.onStart(agentId, task, agentName)

    await acquire()
    try {
      // Lazy import to avoid circular dependency
      const { allTools } = await import('../index.js')
      const subagentTools = allTools.filter((t) => t.name !== 'subagent' && t.name !== 'ask_agent')

      // Filter tools by role
      const filteredTools = getToolsForRole(role, subagentTools)

      // Build prompt: fixed agent uses specialized prompt, generic uses the standard one
      const memory = formatMemoryForPrompt(getCurrentMemory())
      const prompt = fixedAgent
        ? buildFixedAgentPrompt(fixedAgent, task, memory)
        : buildSubAgentPrompt(task, role)

      const { resultText, totalTokens } = await runSubAgentLoop(
        prompt, task, agentId, filteredTools, provider, modelName,
        { onToolUse: (id, tool, info) => subAgentCallbacks?.onToolUse(id, tool, info) },
      )

      // Parse structured result
      const structured = parseSubAgentResult(resultText)

      // Add to task memory for sibling subagents
      addPreviousResult(getCurrentMemory(), task, structured.summary, structured.confidence)

      // Verification check
      let verificationSuffix = ''
      if (shouldVerify(task, structured, args.verify as boolean | undefined)) {
        await acquire()
        try {
          const verifierPrompt = buildVerifierPrompt(task, structured)
          const verifierTools = getToolsForRole('reader', subagentTools)
          const { resultText: verifierText } = await runSubAgentLoop(
            verifierPrompt, verifierPrompt, `${agentId}-v`, verifierTools, provider, modelName,
            { onToolUse: (id, tool, info) => subAgentCallbacks?.onToolUse(id, tool, info) },
          )
          const verification = parseVerificationResult(verifierText)
          verificationSuffix = `\n${formatVerificationForUser(verification)}`
        } finally {
          release()
        }
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
