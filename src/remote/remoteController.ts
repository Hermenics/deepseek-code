import { RemoteBridge } from './bridge.js'
import { RemoteSession } from './session.js'
import type { FrameWithoutMeta } from './session.js'
import { startPairing } from './pairing.js'
import * as deviceStore from './deviceStore.js'
import type { TrustedDevice } from './deviceStore.js'
import { randomUUID } from 'node:crypto'

export type RemoteControlState = 'disconnected' | 'pairing' | 'connected'
export type OnPromptFromMobile = (content: string) => void

const DEFAULT_RELAY_URL = 'http://localhost:8787'

export class RemoteController {
  private state: RemoteControlState = 'disconnected'
  private session: RemoteSession | null = null
  private bridge: RemoteBridge | null = null
  private promptHandler: OnPromptFromMobile | null = null

  get currentState(): RemoteControlState { return this.state }
  get activeSession(): RemoteSession | null { return this.session }

  onPrompt(handler: OnPromptFromMobile): void {
    this.promptHandler = handler
  }

  async start(relayUrl = DEFAULT_RELAY_URL): Promise<{ success: boolean; error?: string }> {
    const devices = await deviceStore.listDevices()

    if (devices.length === 0) {
      this.state = 'pairing'
      const result = await startPairing(relayUrl)
      if (!result.success) {
        this.state = 'disconnected'
        return { success: false, error: result.error }
      }
      const device = await deviceStore.getDevice(result.deviceId!)
      if (!device) {
        this.state = 'disconnected'
        return { success: false, error: 'Device not found after pairing' }
      }
      return this.connectToDevice(device, relayUrl)
    }

    return this.connectToDevice(devices[0], relayUrl)
  }

  private async connectToDevice(device: TrustedDevice, relayUrl: string): Promise<{ success: boolean; error?: string }> {
    try {
      this.bridge = new RemoteBridge()
      const keyPair = await deviceStore.getOrCreateKeyPair()
      const res = await fetch(`${relayUrl}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cliId: `cli-${randomUUID()}`, publicKey: keyPair.publicKey }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const { sessionId, wsUrl } = await res.json() as { sessionId: string; wsUrl: string }

      await this.bridge.connect(wsUrl, sessionId, 'cli')

      this.session = new RemoteSession(this.bridge, device.sharedSecret, sessionId)
      this.session.start()

      this.session.onFrame('prompt', (frame) => {
        this.promptHandler?.(frame.content)
      })

      this.session.onFrame('tool_approval', (frame) => {
        // TODO: integrate with useToolPermission hook
        console.log(`[RC] Tool ${frame.toolId} ${frame.approved ? 'approved' : 'rejected'} by mobile`)
      })

      this.session.sendFrame({ type: 'agent_status', status: 'idle' } as FrameWithoutMeta)
      this.state = 'connected'
      return { success: true }
    } catch (err) {
      this.state = 'disconnected'
      return { success: false, error: (err as Error).message }
    }
  }

  stop(): void {
    this.session?.stop('user_disconnect')
    this.session = null
    this.bridge?.disconnect()
    this.bridge = null
    this.state = 'disconnected'
  }

  async getStatus(): Promise<{ state: RemoteControlState; devices: number }> {
    const devices = await deviceStore.listDevices()
    return { state: this.state, devices: devices.length }
  }
}

export const remoteController = new RemoteController()
