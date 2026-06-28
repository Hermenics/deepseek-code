import { describe, it, expect } from 'bun:test'
import {
  generateKeyPair,
  deriveSharedSecret,
  encrypt,
  decrypt,
  generateVerificationCode,
} from '../../packages/remote-shared/src/crypto.js'

describe('crypto', () => {
  it('generateKeyPair returns base64 strings of correct length', () => {
    const kp = generateKeyPair()
    expect(typeof kp.publicKey).toBe('string')
    expect(typeof kp.secretKey).toBe('string')
    // Curve25519 keys are 32 bytes → 44 chars base64
    expect(Buffer.from(kp.publicKey, 'base64').length).toBe(32)
    expect(Buffer.from(kp.secretKey, 'base64').length).toBe(32)
  })

  it('deriveSharedSecret is symmetric', () => {
    const alice = generateKeyPair()
    const bob = generateKeyPair()
    const s1 = deriveSharedSecret(bob.publicKey, alice.secretKey)
    const s2 = deriveSharedSecret(alice.publicKey, bob.secretKey)
    expect(s1).toBe(s2)
  })

  it('encrypt produces ciphertext + 24-byte nonce', () => {
    const { sharedKey } = setup()
    const { ciphertext, nonce } = encrypt('hello', sharedKey)
    expect(typeof ciphertext).toBe('string')
    expect(Buffer.from(nonce, 'base64').length).toBe(24)
  })

  it('decrypt round-trips plaintext', () => {
    const { sharedKey } = setup()
    const plaintext = 'round trip test 🔒'
    const { ciphertext, nonce } = encrypt(plaintext, sharedKey)
    expect(decrypt(ciphertext, nonce, sharedKey)).toBe(plaintext)
  })

  it('decrypt throws on wrong key', () => {
    const { sharedKey } = setup()
    const wrong = setup().sharedKey
    const { ciphertext, nonce } = encrypt('secret', sharedKey)
    expect(() => decrypt(ciphertext, nonce, wrong)).toThrow('Decryption failed')
  })

  it('generateVerificationCode is 6 digits', () => {
    const { sharedKey } = setup()
    const code = generateVerificationCode(sharedKey)
    expect(code).toMatch(/^\d{6}$/)
  })

  it('generateVerificationCode is deterministic', () => {
    const { sharedKey } = setup()
    expect(generateVerificationCode(sharedKey)).toBe(generateVerificationCode(sharedKey))
  })
})

function setup() {
  const alice = generateKeyPair()
  const bob = generateKeyPair()
  const sharedKey = deriveSharedSecret(bob.publicKey, alice.secretKey)
  return { alice, bob, sharedKey }
}
