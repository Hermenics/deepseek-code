import { RemoteSession } from './session.js'
import type { FrameWithoutMeta } from './session.js'
import { startPairing } from './pairing.js'
import { listDevices } from './deviceStore.js'
import type { Agent, AgentCallbacks, ToolPermissionResult } from '../agent/agent.js'
import type {
  ToolApprovalFrame,
  AgentStatusFrame,
  SessionEndFrame,
} from '../../packages/remote-shared/src/types.js'

const RELAY_URL = process.env['DEEPSEEK_RELAY_URL'] ?? 'wss://relay.deepseek-code.dev'

export interface RemoteControlState {
  active: boolean
  deviceId: string | null
  deviceName: string | null
  connectedAt: number | null
}

/**
 * Connects the remote-control system to the Agent's existing callbacks.
 *
 * Integration points in agent.ts:
 *   1. Input  — injects remote prompts via agent.run()
 *   2. Output — wraps AgentCallbacks to emit ResponseDelta/ToolCall/etc frames
 *   3. Approval — replaces toolPermissionHandler when a remote session is active
 */
export class AgentRemoteBridge {
  private session: RemoteSession | null = null
  private state: RemoteControlState = { active: false, deviceId: null, deviceName: null, connectedAt: null }
  private pendingApprovals: Map<string, (approved: boolean) => void> = new Map()

  constructor(private agent: Agent) {}

  getState(): RemoteControlState {
    return { ...this.state }
  }

  // ── Pairing ──────────────────────────────────────────────────────────────

  async pair(): Promise<string> {
    const result = await startPairing(RELAY_URL)
    if (!result.success) return `Pareamento falhou: ${result.error}`
    return `Dispositivo "${result.deviceName}" pareado com sucesso. ID: ${result.deviceId}`
  }

  // ── Session start/stop ───────────────────────────────────────────────────

  async start(deviceId?: string, onPrompt?: (prompt: string) => void): Promise<string> {
    if (this.state.active) return 'Sessão remota já está ativa.'

    let targetDeviceId = deviceId
    if (!targetDeviceId) {
      const devices = await listDevices()
      if (devices.length === 0) return 'Nenhum dispositivo pareado. Use /rc pair primeiro.'
      targetDeviceId = devices[0]!.deviceId
    }

    let session: RemoteSession
    try {
      session = await RemoteSession.create({
        sessionId: `session-${Date.now()}`,
        deviceId: targetDeviceId,
        relayUrl: RELAY_URL,
        cliId: `cli-${Date.now()}`,
        onPrompt: (content) => onPrompt?.(content),
        onToolApproval: (toolId, approved) => {
          const resolve = this.pendingApprovals.get(toolId)
          if (resolve) {
            this.pendingApprovals.delete(toolId)
            resolve(approved)
          }
        },
        onDisconnect: () => this.stopInternal('user_disconnect'),
      })
    } catch (err) {
      return `Falha ao conectar ao relay: ${(err as Error).message}`
    }

    // Register tool approval handler on the agent
    this.agent.setToolPermissionHandler((toolName, args) =>
      this.requestRemoteApproval(toolName, args as Record<string, unknown>)
    )

    // Handle session_end from mobile
    session.onFrame('session_end', () => this.stopInternal('user_disconnect'))

    // Announce session to mobile
    session.sendFrame({
      type: 'session_start',
      sessionId: session['sessionId'] as string,
      deviceId: targetDeviceId,
    } as FrameWithoutMeta)

    this.session = session

    // Fetch device name for state
    const { getDevice } = await import('./deviceStore.js')
    const device = await getDevice(targetDeviceId)
    this.state = {
      active: true,
      deviceId: targetDeviceId,
      deviceName: device?.deviceName ?? targetDeviceId,
      connectedAt: Date.now(),
    }

    return `Sessão remota iniciada com "${this.state.deviceName}".`
  }

  stop(): string {
    if (!this.state.active) return 'Nenhuma sessão remota ativa.'
    this.stopInternal('cli_shutdown')
    return 'Sessão remota encerrada.'
  }

  private stopInternal(reason: SessionEndFrame['reason']): void {
    this.agent.setToolPermissionHandler(null)
    this.session?.stop(reason)
    this.session = null
    this.state = { active: false, deviceId: null, deviceName: null, connectedAt: null }
    for (const resolve of this.pendingApprovals.values()) resolve(false)
    this.pendingApprovals.clear()
  }

  // ── AgentCallbacks wrapper ───────────────────────────────────────────────

  /**
   * Wraps TUI callbacks to forward output frames to the mobile session.
   * Call this before agent.run() to inject remote forwarding transparently.
   */
  wrapCallbacks(cb: AgentCallbacks): AgentCallbacks {
    if (!this.state.active || !this.session) return cb

    const session = this.session

    const emitStatus = (status: AgentStatusFrame['status']) => {
      session.sendFrame({ type: 'agent_status', status } as FrameWithoutMeta)
    }

    return {
      ...cb,
      onToken: (text) => {
        cb.onToken(text)
        session.sendFrame({ type: 'response_delta', content: text, done: false } as FrameWithoutMeta)
      },
      onDone: () => {
        cb.onDone()
        session.sendFrame({ type: 'response_delta', content: '', done: true } as FrameWithoutMeta)
        emitStatus('idle')
      },
      onToolCall: (name, args) => {
        cb.onToolCall(name, args)
        emitStatus('tool_executing')
        session.sendFrame({
          type: 'tool_call',
          toolId: `${name}-${Date.now()}`,
          toolName: name,
          args: args as Record<string, unknown>,
          requiresApproval: false,
        } as FrameWithoutMeta)
      },
      onToolResult: (name, result, args) => {
        cb.onToolResult(name, result, args)
      },
      onPhaseChange: (phase) => {
        cb.onPhaseChange?.(phase)
        if (phase === 'executing') emitStatus('thinking')
      },
    }
  }

  // ── Tool approval via mobile ─────────────────────────────────────────────

  private async requestRemoteApproval(toolName: string, args: Record<string, unknown>): Promise<ToolPermissionResult> {
    if (!this.session || !this.state.active) return 'deny'

    const toolId = `${toolName}-${Date.now()}`

    this.session.sendFrame({
      type: 'tool_call',
      toolId,
      toolName,
      args,
      requiresApproval: true,
    } as FrameWithoutMeta)

    const approved = await Promise.race([
      new Promise<boolean>((resolve) => {
        this.pendingApprovals.set(toolId, resolve)
      }),
      new Promise<boolean>((resolve) =>
        setTimeout(() => {
          this.pendingApprovals.delete(toolId)
          resolve(false)
        }, 5 * 60 * 1000),
      ),
    ])

    return approved ? 'once' : 'deny'
  }
}
