import nacl from 'tweetnacl'
import { encodeBase64 } from 'tweetnacl-util'
import { encrypt, decrypt } from './crypto.js'
import type { Frame, EncryptedEnvelope, FrameMeta } from './types.js'

export function createMeta(seq: number): FrameMeta {
  return {
    seq,
    ts: Date.now(),
    nonce: encodeBase64(nacl.randomBytes(24)),
  }
}

export function encodeFrame(frame: Frame, sharedKey: string, sessionId: string): EncryptedEnvelope {
  const { ciphertext, nonce } = encrypt(JSON.stringify(frame), sharedKey)
  return { sessionId, ciphertext, nonce }
}

export function decodeFrame(envelope: EncryptedEnvelope, sharedKey: string): Frame {
  const json = decrypt(envelope.ciphertext, envelope.nonce, sharedKey)
  return JSON.parse(json) as Frame
}
