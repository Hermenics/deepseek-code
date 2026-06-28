import type { RemoteSession, FrameWithoutMeta } from './session.js'
import type { AgentCallbacks } from '../agent/agent.js'

/**
 * Wraps existing AgentCallbacks to also emit frames to a RemoteSession.
 * The original callbacks still fire (for local TUI rendering).
 */
export function wrapCallbacksForRemote(
  original: AgentCallbacks,
  session: RemoteSession,
): AgentCallbacks {
  return {
    onToken(text: string) {
      original.onToken(text)
      session.sendFrame({ type: 'response_delta', content: text, done: false } as FrameWithoutMeta)
    },

    onThinking(text: string) {
      original.onThinking?.(text)
      // ponytail: thinking stays local — don't stream to mobile
    },

    onToolCall(name: string, args: object) {
      original.onToolCall(name, args)
      session.sendFrame({
        type: 'tool_call',
        toolId: `${name}-${Date.now()}`,
        toolName: name,
        args: args as Record<string, unknown>,
        requiresApproval: true,
      } as FrameWithoutMeta)
    },

    onToolResult(name: string, result: string, args: Record<string, unknown>) {
      original.onToolResult(name, result, args)
      session.sendFrame({ type: 'terminal_output', output: `✓ ${name}: ${result.slice(0, 500)}` } as FrameWithoutMeta)
    },

    onDone() {
      original.onDone()
      session.sendFrame({ type: 'response_delta', content: '', done: true } as FrameWithoutMeta)
      session.sendFrame({ type: 'agent_status', status: 'idle' } as FrameWithoutMeta)
    },

    onPhaseChange(phase) {
      original.onPhaseChange?.(phase)
    },

    onAutoCompact(summary) {
      original.onAutoCompact?.(summary)
    },

    onDenyAbort() {
      original.onDenyAbort?.()
    },
  }
}
