import { describe, it, expect } from 'bun:test'
import { createMeta, encodeFrame, decodeFrame } from '../../packages/remote-shared/src/protocol.js'
import { generateKeyPair, deriveSharedSecret } from '../../packages/remote-shared/src/crypto.js'
import type { HeartbeatFrame, PromptFrame } from '../../packages/remote-shared/src/types.js'

describe('protocol', () => {
  const { sharedKey, sessionId } = setup()

  it('createMeta has correct shape', () => {
    const meta = createMeta(5)
    expect(meta.seq).toBe(5)
    expect(typeof meta.ts).toBe('number')
    expect(Buffer.from(meta.nonce, 'base64').length).toBe(24)
  })

  it('createMeta nonces are unique', () => {
    const a = createMeta(1)
    const b = createMeta(1)
    expect(a.nonce).not.toBe(b.nonce)
  })

  it('encodeFrame + decodeFrame round-trips a heartbeat', () => {
    const frame: HeartbeatFrame = { type: 'heartbeat', meta: createMeta(1) }
    const envelope = encodeFrame(frame, sharedKey, sessionId)
    expect(envelope.sessionId).toBe(sessionId)
    const decoded = decodeFrame(envelope, sharedKey)
    expect(decoded).toEqual(frame)
  })

  it('encodeFrame + decodeFrame round-trips a prompt', () => {
    const frame: PromptFrame = {
      type: 'prompt',
      meta: createMeta(2),
      content: 'fix the bug',
    }
    const envelope = encodeFrame(frame, sharedKey, sessionId)
    const decoded = decodeFrame(envelope, sharedKey)
    expect(decoded).toEqual(frame)
  })

  it('decodeFrame throws on wrong key', () => {
    const frame: HeartbeatFrame = { type: 'heartbeat', meta: createMeta(1) }
    const envelope = encodeFrame(frame, sharedKey, sessionId)
    const wrongKey = deriveSharedSecret(generateKeyPair().publicKey, generateKeyPair().secretKey)
    expect(() => decodeFrame(envelope, wrongKey)).toThrow()
  })
})

function setup() {
  const alice = generateKeyPair()
  const bob = generateKeyPair()
  const sharedKey = deriveSharedSecret(bob.publicKey, alice.secretKey)
  return { sharedKey, sessionId: 'test-session-id' }
}
