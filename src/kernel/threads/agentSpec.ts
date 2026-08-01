import type { PermissionProfile, WorkspaceIsolation } from '../../orchestration/types.js'

// ── Agent Specification (pure data, fully serializable) ────────────

export type ContextMode = 'fresh' | 'summary' | 'last_n_turns' | 'full'
export type AgentRole = 'planner' | 'reader' | 'writer' | 'executor' | 'reviewer' | 'verifier' | 'integrator'

export interface AgentSpec {
  /** Stable identity. Survives restarts. */
  agent_id: string
  /** Human-readable name for display. */
  name: string
  /** Parent agent that spawned this one. Empty for root. */
  parent_agent_id?: string
  /** Role determines default tool set and permissions. */
  role: AgentRole
  /** System prompt / template identity. Points to a known template or inline. */
  system_prompt: string
  /** Model + provider configuration. */
  provider: string
  model: string
  /** Reasoning effort: low, medium, high, xhigh, max */
  effort?: string
  /** Which tools this agent can use. '*' for all. */
  allowed_tools: string[] | '*'
  /** Permission profile for tool execution. */
  permission_profile: PermissionProfile
  /** Workspace isolation strategy. */
  workspace_isolation: WorkspaceIsolation
  /** How parent context is passed to this agent. */
  context_mode: ContextMode
  /** For last_n_turns: number of parent turns to include. */
  context_window?: number
  /** Maximum tokens this agent can consume. */
  max_tokens?: number
  /** Maximum cost in USD. */
  max_cost_usd?: number
  /** Turn timeout in milliseconds. */
  timeout_ms: number
  /** Maximum retries for failed turns. */
  max_retries: number
  /** Maximum depth of sub-agents this agent can spawn. */
  max_depth: number
  /** Maximum concurrent sub-agents. */
  max_fan_out: number
  /** Whether this agent can delegate to sub-agents. */
  allow_delegation: boolean
  /** Paths this agent owns for write isolation. */
  owns_paths?: string[]
  /** Arbitrary metadata for extension. */
  metadata: Record<string, unknown>
}

export const DEFAULT_AGENT_SPEC: Omit<AgentSpec, 'agent_id' | 'name' | 'system_prompt'> = {
  role: 'reader',
  provider: 'deepseek',
  model: 'deepseek-v4-flash',
  allowed_tools: '*',
  permission_profile: 'researcher-readonly',
  workspace_isolation: 'readonly-shared',
  context_mode: 'fresh',
  timeout_ms: 120_000,
  max_retries: 1,
  max_depth: 2,
  max_fan_out: 5,
  allow_delegation: false,
  metadata: {},
}

/** Create an AgentSpec with defaults applied. */
export function createAgentSpec(overrides: Partial<AgentSpec> & Pick<AgentSpec, 'agent_id' | 'name' | 'system_prompt'>): AgentSpec {
  return { ...DEFAULT_AGENT_SPEC, ...overrides }
}

/** Validate an AgentSpec for correctness. */
export function validateAgentSpec(spec: AgentSpec): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  if (!spec.agent_id) errors.push('agent_id is required')
  if (!spec.name) errors.push('name is required')
  if (!spec.system_prompt) errors.push('system_prompt is required')
  if (!['fresh', 'summary', 'last_n_turns', 'full'].includes(spec.context_mode)) {
    errors.push(`Invalid context_mode: ${spec.context_mode}`)
  }
  assertFiniteInteger(spec.timeout_ms, 'timeout_ms', errors, 1, 86_400_000)
  assertFiniteInteger(spec.max_retries, 'max_retries', errors, 0, 10)
  assertFiniteInteger(spec.max_depth, 'max_depth', errors, 0, 32)
  assertFiniteInteger(spec.max_fan_out, 'max_fan_out', errors, 1, 100)
  return { valid: errors.length === 0, errors }
}

function assertFiniteInteger(
  value: unknown,
  name: string,
  errors: string[],
  min: number,
  max: number,
): void {
  // Reject undefined, null, NaN, Infinity, strings, and other non-number values.
  if (value === undefined || value === null) {
    errors.push(`${name} is required`)
    return
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
    errors.push(`${name} must be a finite integer number`)
    return
  }
  if (value < min || value > max) {
    errors.push(`${name} out of range [${min}, ${max}]`)
  }
}
