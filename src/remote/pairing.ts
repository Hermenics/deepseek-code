import { RemoteBridge } from './bridge.js'
import { getOrCreateKeyPair, addDevice } from './deviceStore.js'
import { renderPairingQR } from './qrCode.js'
import { deriveSharedSecret, generateVerificationCode } from '../../packages/remote-shared/src/crypto.js'
import { decodeFrame, encodeFrame, createMeta } from '../../packages/remote-shared/src/protocol.js'
import type { PairingHelloFrame, PairingAckFrame } from '../../packages/remote-shared/src/types.js'
import { randomUUID } from 'node:crypto'

export interface PairingResult {
  success: boolean
  deviceId?: string
  deviceName?: string
  error?: string
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout: ${label}`)), ms),
    ),
  ])
}

export async function startPairing(relayUrl: string): Promise<PairingResult> {
  const keyPair = await getOrCreateKeyPair()
  const cliId = `cli-${randomUUID()}`

  let sessionId: string
  try {
    const res = await fetch(`${relayUrl}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cliId, publicKey: keyPair.publicKey }),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = (await res.json()) as { sessionId: string; wsUrl: string }
    sessionId = data.sessionId
  } catch (err) {
    return { success: false, error: `Failed to create session: ${(err as Error).message}` }
  }

  renderPairingQR({ sessionId, relayUrl, cliPublicKey: keyPair.publicKey })

  const bridge = new RemoteBridge()
  try {
    await bridge.connect(relayUrl, sessionId, 'cli')
  } catch (err) {
    return { success: false, error: `Failed to connect to relay: ${(err as Error).message}` }
  }

  try {
    // Step 1: wait for PairingHelloFrame from mobile (5 min timeout)
    const helloFrame = await withTimeout(
      new Promise<PairingHelloFrame>((resolve, reject) => {
        bridge.onDisconnect((reason) => reject(new Error(`Disconnected: ${reason}`)))
        bridge.onMessage((envelope) => {
          try {
            // ponytail: no sharedKey yet — hello is sent unencrypted (plaintext JSON in ciphertext field)
            const frame = JSON.parse(envelope.ciphertext)
            if (frame.type === 'pairing_hello') resolve(frame as PairingHelloFrame)
          } catch {
            // ignore malformed
          }
        })
      }),
      5 * 60 * 1000,
      'waiting for mobile hello',
    )

    const sharedSecret = deriveSharedSecret(helloFrame.publicKey, keyPair.secretKey)
    const verificationCode = generateVerificationCode(sharedSecret)

    console.log(`\nCódigo de verificação: ${verificationCode}\n`)

    const ack: PairingAckFrame = {
      type: 'pairing_ack',
      meta: createMeta(1),
      cliPublicKey: keyPair.publicKey,
      verificationCode,
      accepted: true,
    }
    // ponytail: ack sent unencrypted — mobile doesn't have sharedKey yet
    bridge.send({ sessionId, ciphertext: JSON.stringify(ack), nonce: '' })

    // Step 2: wait for PairingConfirmFrame (2 min timeout)
    const confirmFrame = await withTimeout(
      new Promise<{ verificationCode: string }>((resolve, reject) => {
        bridge.onDisconnect((reason) => reject(new Error(`Disconnected: ${reason}`)))
        bridge.onMessage((envelope) => {
          try {
            const frame = JSON.parse(envelope.ciphertext)
            if (frame.type === 'pairing_confirm') resolve(frame)
          } catch {
            // ignore
          }
        })
      }),
      2 * 60 * 1000,
      'waiting for mobile confirmation',
    )

    if (confirmFrame.verificationCode !== verificationCode) {
      bridge.disconnect()
      return { success: false, error: 'Verification code mismatch' }
    }

    const deviceId = randomUUID()
    const now = Date.now()
    await addDevice({
      deviceId,
      deviceName: helloFrame.deviceName,
      publicKey: helloFrame.publicKey,
      sharedSecret,
      pairedAt: now,
      lastSeen: now,
    })

    bridge.disconnect()
    return { success: true, deviceId, deviceName: helloFrame.deviceName }
  } catch (err) {
    bridge.disconnect()
    return { success: false, error: (err as Error).message }
  }
}
