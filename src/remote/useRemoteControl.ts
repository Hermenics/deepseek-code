import { useRef, useCallback } from 'react'
import { RemoteSession } from './session.js'
import { startPairing } from './pairing.js'
import { listDevices, removeDevice } from './deviceStore.js'
import { createMeta } from '../../packages/remote-shared/src/protocol.js'
import type {
  ResponseDeltaFrame,
  ToolCallFrame,
  ToolApprovalFrame,
  AgentStatusFrame,
} from '../../packages/remote-shared/src/types.js'
import type { AgentCallbacks } from '../agent/agent.js'

const DEFAULT_RELAY = process.env.DEEPSEEK_RELAY_URL ?? 'http://localhost:8787'

export type RemoteStatus = 'idle' | 'pairing' | 'connected' | 'error'

export interface RemoteControl {
  status: RemoteStatus
  start(relayUrl?: string): Promise<string>
  stop(): void
  getStatus(): string
  getDevices(): Promise<string>
  unpair(deviceId?: string): Promise<string>
  /** Wrap agent callbacks to also emit frames to connected mobile */
  wrapCallbacks(base: AgentCallbacks, seq: () => number): AgentCallbacks
}

export function useRemoteControl(): RemoteControl {
  const sessionRef = useRef<RemoteSession | null>(null)
  const statusRef = useRef<RemoteStatus>('idle')

  const start = useCallback(async (relayUrl = DEFAULT_RELAY): Promise<string> => {
    if (statusRef.current === 'connected') {
      return 'Already connected. Use /rc stop first.'
    }
    statusRef.current = 'pairing'
    const result = await startPairing(relayUrl)
    if (!result.success) {
      statusRef.current = 'error'
      return `Pairing failed: ${result.error}`
    }

    const devices = await listDevices()
    const device = devices.find((d) => d.deviceId === result.deviceId)
    if (!device) {
      statusRef.current = 'error'
      return 'Device not found after pairing.'
    }

    let pendingToolApprovals: Map<string, (approved: boolean) => void> = new Map()

    const session = await RemoteSession.create({
      sessionId: crypto.randomUUID(),
      deviceId: device.deviceId,
      relayUrl,
      cliId: `cli-${Date.now()}`,
      onPrompt: () => {
        // ponytail: prompt from mobile not handled here — handled via wrapCallbacks queue
      },
      onToolApproval: (toolId, approved) => {
        const resolve = pendingToolApprovals.get(toolId)
        if (resolve) {
          pendingToolApprovals.delete(toolId)
          resolve(approved)
        }
      },
      onDisconnect: () => {
        statusRef.current = 'idle'
        sessionRef.current = null
      },
    })

    session.start()
    sessionRef.current = session
    statusRef.current = 'connected'
    return `Connected. Device: ${result.deviceName}`
  }, [])

  const stop = useCallback(() => {
    sessionRef.current?.close('cli_shutdown')
    sessionRef.current = null
    statusRef.current = 'idle'
  }, [])

  const getStatus = useCallback((): string => {
    const s = statusRef.current
    if (s === 'connected') return `Remote control active. Session: ${(sessionRef.current as any)?.opts?.sessionId ?? 'unknown'}`
    return `Remote control ${s}.`
  }, [])

  const getDevices = useCallback(async (): Promise<string> => {
    const devices = await listDevices()
    if (!devices.length) return 'No paired devices.'
    return devices.map((d) => `  ${d.deviceId.slice(0, 8)}  ${d.deviceName}  paired ${new Date(d.pairedAt).toLocaleDateString()}`).join('\n')
  }, [])

  const unpair = useCallback(async (deviceId?: string): Promise<string> => {
    if (!deviceId) return 'Usage: /rc unpair <deviceId>'
    await removeDevice(deviceId)
    return `Device ${deviceId} removed.`
  }, [])

  const wrapCallbacks = useCallback((base: AgentCallbacks, nextSeq: () => number): AgentCallbacks => {
    const session = sessionRef.current
    if (!session) return base

    return {
      ...base,
      onToken(token) {
        base.onToken(token)
        const frame: ResponseDeltaFrame = {
          type: 'response_delta',
          meta: createMeta(nextSeq()),
          content: token,
          done: false,
        }
        session.sendFrame(frame)
      },
      onToolCall(name, args) {
        base.onToolCall(name, args)
        const toolId = `tool-${Date.now()}`
        const frame: ToolCallFrame = {
          type: 'tool_call',
          meta: createMeta(nextSeq()),
          toolId,
          toolName: name,
          args: args as Record<string, unknown>,
          requiresApproval: false,
        }
        session.sendFrame(frame)
        session.sendStatus('tool_executing')
      },
      onToolResult(name, result, args) {
        base.onToolResult(name, result, args)
        session.sendStatus('thinking')
      },
      onDone() {
        base.onDone()
        const frame: ResponseDeltaFrame = {
          type: 'response_delta',
          meta: createMeta(nextSeq()),
          content: '',
          done: true,
        }
        session.sendFrame(frame)
        session.sendStatus('idle')
      },
    }
  }, [])

  return { status: statusRef.current, start, stop, getStatus, getDevices, unpair, wrapCallbacks }
}
