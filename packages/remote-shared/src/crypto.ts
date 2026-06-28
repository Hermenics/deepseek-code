import nacl from 'tweetnacl'
import { encodeBase64, decodeBase64 } from 'tweetnacl-util'

export interface KeyPair {
  publicKey: string  // Base64
  secretKey: string  // Base64
}

export interface EncryptResult {
  ciphertext: string  // Base64
  nonce: string       // Base64
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export function generateKeyPair(): KeyPair {
  const kp = nacl.box.keyPair()
  return {
    publicKey: encodeBase64(kp.publicKey),
    secretKey: encodeBase64(kp.secretKey),
  }
}

export function deriveSharedSecret(theirPublicKey: string, mySecretKey: string): string {
  const sharedKey = nacl.box.before(decodeBase64(theirPublicKey), decodeBase64(mySecretKey))
  return encodeBase64(sharedKey)
}

export function encrypt(plaintext: string, sharedKey: string): EncryptResult {
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength)  // 24 bytes
  const message = encoder.encode(plaintext)
  const ciphertext = nacl.secretbox(message, nonce, decodeBase64(sharedKey))
  return {
    ciphertext: encodeBase64(ciphertext),
    nonce: encodeBase64(nonce),
  }
}

export function decrypt(ciphertext: string, nonce: string, sharedKey: string): string {
  const plaintext = nacl.secretbox.open(
    decodeBase64(ciphertext),
    decodeBase64(nonce),
    decodeBase64(sharedKey),
  )
  if (plaintext === null) {
    throw new Error('Decryption failed: invalid ciphertext or key')
  }
  return decoder.decode(plaintext)
}

export function generateVerificationCode(sharedSecret: string): string {
  // Deterministic 6-digit code derived from first 3 bytes of shared secret
  const bytes = decodeBase64(sharedSecret)
  const num = ((bytes[0] << 16) | (bytes[1] << 8) | bytes[2]) % 1_000_000
  return num.toString().padStart(6, '0')
}
