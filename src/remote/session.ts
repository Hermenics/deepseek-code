import { RemoteBridge } from './bridge.js'
import { getDevice } from './deviceStore.js'
import { encodeFrame, decodeFrame, createMeta } from '../../packages/remote-shared/src/protocol.js'
import type { Frame, EncryptedEnvelope, SessionEndFrame, AgentStatusFrame } from '../../packages/remote-shared/src/types.js'

// ponytail: distributive Omit preserves discriminated union narrowing
export type FrameWithoutMeta = { [K in Frame['type']]: Omit<Extract<Frame, { type: K }>, 'meta'> }[Frame['type']]

export interface SessionOptions {
  sessionId: string
  deviceId: string
  relayUrl: string
  cliId: string
  onPrompt?: (content: string) => void
  onToolApproval?: (toolId: string, approved: boolean) => void
  onDisconnect?: () => void
}

export class RemoteSession {
  private bridge: RemoteBridge
  private sharedKey: string
  private sessionId: string
  private seq = 0
  private frameHandlers: Map<string, (frame: Frame) => void> = new Map()

  constructor(bridge: RemoteBridge, sharedKey: string, sessionId: string, private opts?: SessionOptions) {
    this.bridge = bridge
    this.sharedKey = sharedKey
    this.sessionId = sessionId
  }

  static async create(opts: SessionOptions): Promise<RemoteSession> {
    const device = await getDevice(opts.deviceId)
    if (!device) throw new Error(`Device ${opts.deviceId} not found in trust store`)

    const bridge = new RemoteBridge()
    const session = new RemoteSession(bridge, device.sharedSecret, opts.sessionId, opts)

    if (opts.onDisconnect) {
      bridge.onDisconnect(() => opts.onDisconnect!())
    }

    bridge.onMessage((envelope: EncryptedEnvelope) => {
      try {
        const frame = decodeFrame(envelope, device.sharedSecret)
        if (frame.type === 'prompt' && opts.onPrompt) {
          opts.onPrompt(frame.content)
        } else if (frame.type === 'tool_approval' && opts.onToolApproval) {
          opts.onToolApproval(frame.toolId, frame.approved)
        }
        const handler = session.frameHandlers.get(frame.type)
        handler?.(frame)
      } catch {
        // malformed or wrong key — ignore
      }
    })

    await bridge.connect(opts.relayUrl, opts.sessionId, 'cli', opts.deviceId)
    return session
  }

  start(): void {
    // connection already established in create(); this is a no-op kept for API compatibility
  }

  sendFrame(frame: FrameWithoutMeta): void {
    const full = { ...frame, meta: createMeta(this.nextSeq()) } as Frame
    const envelope = encodeFrame(full, this.sharedKey, this.sessionId)
    this.bridge.send(envelope)
  }

  sendStatus(status: AgentStatusFrame['status'], model?: string, tokensUsed?: number): void {
    this.sendFrame({ type: 'agent_status', status, model, tokensUsed } as FrameWithoutMeta)
  }

  onFrame<T extends Frame['type']>(type: T, handler: (frame: Extract<Frame, { type: T }>) => void): void {
    this.frameHandlers.set(type, handler as (frame: Frame) => void)
  }

  offFrame(type: Frame['type']): void {
    this.frameHandlers.delete(type)
  }

  close(reason: SessionEndFrame['reason'] = 'cli_shutdown'): void {
    const endFrame: Omit<SessionEndFrame, 'meta'> = {
      type: 'session_end',
      reason,
    }
    this.sendFrame(endFrame)
    this.bridge.disconnect()
  }

  stop(reason?: string): void {
    this.close((reason as SessionEndFrame['reason']) ?? 'cli_shutdown')
  }

  private nextSeq(): number {
    return ++this.seq
  }
}
