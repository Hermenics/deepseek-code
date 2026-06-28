/** Sequence metadata on every frame */
export interface FrameMeta {
  seq: number
  ts: number
  nonce: string  // 24-byte random nonce (base64) for replay protection
}

/** CLI → Mobile: Agent text response streaming */
export interface ResponseDeltaFrame {
  type: 'response_delta'
  meta: FrameMeta
  content: string
  done: boolean
}

/** Mobile → CLI: User prompt from mobile */
export interface PromptFrame {
  type: 'prompt'
  meta: FrameMeta
  content: string
  attachments?: string[]  // Base64 images (future)
}

/** CLI → Mobile: Tool wants to execute */
export interface ToolCallFrame {
  type: 'tool_call'
  meta: FrameMeta
  toolId: string
  toolName: string
  args: Record<string, unknown>
  requiresApproval: boolean
}

/** Mobile → CLI: User approves/rejects tool */
export interface ToolApprovalFrame {
  type: 'tool_approval'
  meta: FrameMeta
  toolId: string
  approved: boolean
  reason?: string
}

/** CLI → Mobile: File diff from an edit */
export interface FileDiffFrame {
  type: 'file_diff'
  meta: FrameMeta
  filePath: string
  hunks: Array<{
    oldStart: number
    oldLines: number
    newStart: number
    newLines: number
    content: string
  }>
}

/** CLI → Mobile: Terminal/bash output */
export interface TerminalOutputFrame {
  type: 'terminal_output'
  meta: FrameMeta
  output: string
  exitCode?: number
}

/** Bidirectional: Terminal resize */
export interface ResizeFrame {
  type: 'resize'
  meta: FrameMeta
  cols: number
  rows: number
}

/** Bidirectional: Keep-alive */
export interface HeartbeatFrame {
  type: 'heartbeat'
  meta: FrameMeta
}

/** Mobile → CLI: Initial pairing hello */
export interface PairingHelloFrame {
  type: 'pairing_hello'
  meta: FrameMeta
  deviceName: string
  publicKey: string  // Base64 Curve25519 public key
}

/** CLI → Mobile: Pairing acknowledged */
export interface PairingAckFrame {
  type: 'pairing_ack'
  meta: FrameMeta
  cliPublicKey: string
  verificationCode: string  // 6-digit code shown on CLI
  accepted: boolean
}

/** Mobile → CLI: Verification code confirmed */
export interface PairingConfirmFrame {
  type: 'pairing_confirm'
  meta: FrameMeta
  verificationCode: string
}

/** Bidirectional: Session lifecycle */
export interface SessionStartFrame {
  type: 'session_start'
  meta: FrameMeta
  sessionId: string
  deviceId: string
}

export interface SessionEndFrame {
  type: 'session_end'
  meta: FrameMeta
  reason: 'timeout' | 'user_disconnect' | 'cli_shutdown' | 'unpaired'
}

/** CLI → Mobile: Agent status updates */
export interface AgentStatusFrame {
  type: 'agent_status'
  meta: FrameMeta
  status: 'idle' | 'thinking' | 'tool_executing' | 'waiting_approval'
  model?: string
  tokensUsed?: number
}

/** All possible frames */
export type Frame =
  | ResponseDeltaFrame
  | PromptFrame
  | ToolCallFrame
  | ToolApprovalFrame
  | FileDiffFrame
  | TerminalOutputFrame
  | ResizeFrame
  | HeartbeatFrame
  | PairingHelloFrame
  | PairingAckFrame
  | PairingConfirmFrame
  | SessionStartFrame
  | SessionEndFrame
  | AgentStatusFrame

/** Encrypted envelope sent over WebSocket */
export interface EncryptedEnvelope {
  sessionId: string
  ciphertext: string  // Base64 encrypted Frame JSON
  nonce: string       // Base64 24-byte nonce
}

/** Active session state */
export interface RemoteSession {
  sessionId: string
  deviceId: string
  cliId: string
  state: 'pairing' | 'active' | 'reconnecting' | 'closed'
  createdAt: number
  lastActivity: number
  lastSeq: number
  ephemeralKey?: string
}
