import type { EncryptedEnvelope } from '../../packages/remote-shared/src/types.js'

const RECONNECT_DELAYS = [1000, 2000, 4000]
const HEARTBEAT_INTERVAL = 30_000

export class RemoteBridge {
  private ws: WebSocket | null = null
  private sessionId: string | null = null
  private messageHandlers: Array<(envelope: EncryptedEnvelope) => void> = []
  private disconnectHandlers: Array<(reason: string) => void> = []
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private lastActivity = 0
  private relayUrl = ''
  private role: 'cli' | 'mobile' = 'cli'
  private deviceId: string | undefined
  private reconnectAttempt = 0
  private stopped = false

  async connect(relayUrl: string, sessionId: string, role: 'cli' | 'mobile', deviceId?: string): Promise<void> {
    this.relayUrl = relayUrl
    this.sessionId = sessionId
    this.role = role
    this.deviceId = deviceId
    this.stopped = false
    this.reconnectAttempt = 0
    return this.openSocket()
  }

  private openSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      const params = new URLSearchParams({ sessionId: this.sessionId!, role: this.role })
      if (this.deviceId) params.set('deviceId', this.deviceId)
      const url = `${this.relayUrl}?${params}`

      const ws = new WebSocket(url)
      this.ws = ws

      ws.onopen = () => {
        this.reconnectAttempt = 0
        this.lastActivity = Date.now()
        this.startHeartbeat()
        resolve()
      }

      ws.onmessage = (event) => {
        this.lastActivity = Date.now()
        try {
          const envelope = JSON.parse(event.data as string) as EncryptedEnvelope
          for (const h of this.messageHandlers) h(envelope)
        } catch {
          // malformed frame — ignore
        }
      }

      ws.onerror = () => {
        // onerror always precedes onclose; let onclose handle reconnect
      }

      ws.onclose = (event) => {
        this.stopHeartbeat()
        if (this.stopped) {
          this.emitDisconnect('closed')
          return
        }
        const delay = RECONNECT_DELAYS[this.reconnectAttempt]
        if (delay === undefined) {
          const reason = event.reason || 'max retries exceeded'
          this.emitDisconnect(reason)
          reject(new Error(`WebSocket connection failed: ${reason}`))
          return
        }
        this.reconnectAttempt++
        setTimeout(() => {
          this.openSocket().then(resolve).catch(reject)
        }, delay)
      }
    })
  }

  send(envelope: EncryptedEnvelope): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(envelope))
      this.lastActivity = Date.now()
    }
  }

  onMessage(handler: (envelope: EncryptedEnvelope) => void): void {
    this.messageHandlers.push(handler)
  }

  onDisconnect(handler: (reason: string) => void): void {
    this.disconnectHandlers.push(handler)
  }

  disconnect(): void {
    this.stopped = true
    this.stopHeartbeat()
    this.ws?.close()
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      if (Date.now() - this.lastActivity >= HEARTBEAT_INTERVAL) {
        this.ws?.send(JSON.stringify({ ping: true }))
        this.lastActivity = Date.now()
      }
    }, HEARTBEAT_INTERVAL)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  private emitDisconnect(reason: string): void {
    for (const h of this.disconnectHandlers) h(reason)
  }
}
