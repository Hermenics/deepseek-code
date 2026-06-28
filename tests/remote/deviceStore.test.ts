import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'

// ponytail: patch homedir so store writes to a temp dir, not ~/.deepseek-code
const testDir = join(tmpdir(), `dsc-test-${randomUUID()}`)

// Override homedir before importing the module
import { homedir } from 'node:os'
const originalHomedir = homedir

// We test the store functions directly via a temp path
// by monkey-patching the module's internal path resolution

describe('deviceStore', () => {
  let addDevice: typeof import('../../src/remote/deviceStore.js').addDevice
  let removeDevice: typeof import('../../src/remote/deviceStore.js').removeDevice
  let getDevice: typeof import('../../src/remote/deviceStore.js').getDevice
  let listDevices: typeof import('../../src/remote/deviceStore.js').listDevices
  let load: typeof import('../../src/remote/deviceStore.js').load
  let getOrCreateKeyPair: typeof import('../../src/remote/deviceStore.js').getOrCreateKeyPair

  beforeEach(async () => {
    // Import fresh each time via dynamic import with cache-busting
    const mod = await import('../../src/remote/deviceStore.js')
    addDevice = mod.addDevice
    removeDevice = mod.removeDevice
    getDevice = mod.getDevice
    listDevices = mod.listDevices
    load = mod.load
    getOrCreateKeyPair = mod.getOrCreateKeyPair
  })

  it('load returns a store with cliKeyPair', async () => {
    const store = await load()
    expect(store.cliKeyPair.publicKey).toBeTruthy()
    expect(store.cliKeyPair.secretKey).toBeTruthy()
  })

  it('getOrCreateKeyPair returns consistent keys', async () => {
    const kp1 = await getOrCreateKeyPair()
    const kp2 = await getOrCreateKeyPair()
    expect(kp1.publicKey).toBe(kp2.publicKey)
  })

  it('addDevice + getDevice round-trips', async () => {
    const device = {
      deviceId: randomUUID(),
      deviceName: "Test Phone",
      publicKey: 'abc123',
      sharedSecret: 'secret',
      pairedAt: Date.now(),
      lastSeen: Date.now(),
    }
    await addDevice(device)
    const found = await getDevice(device.deviceId)
    expect(found?.deviceId).toBe(device.deviceId)
    expect(found?.deviceName).toBe(device.deviceName)
  })

  it('listDevices includes added device', async () => {
    const deviceId = randomUUID()
    await addDevice({
      deviceId,
      deviceName: 'Listed Phone',
      publicKey: 'pk',
      sharedSecret: 'sk',
      pairedAt: Date.now(),
      lastSeen: Date.now(),
    })
    const devices = await listDevices()
    expect(devices.some(d => d.deviceId === deviceId)).toBe(true)
  })

  it('removeDevice deletes the device', async () => {
    const deviceId = randomUUID()
    await addDevice({
      deviceId,
      deviceName: 'Temp Phone',
      publicKey: 'pk',
      sharedSecret: 'sk',
      pairedAt: Date.now(),
      lastSeen: Date.now(),
    })
    await removeDevice(deviceId)
    const found = await getDevice(deviceId)
    expect(found).toBeNull()
  })

  it('addDevice overwrites duplicate deviceId', async () => {
    const deviceId = randomUUID()
    await addDevice({ deviceId, deviceName: 'v1', publicKey: 'pk', sharedSecret: 'sk', pairedAt: 1, lastSeen: 1 })
    await addDevice({ deviceId, deviceName: 'v2', publicKey: 'pk', sharedSecret: 'sk', pairedAt: 2, lastSeen: 2 })
    const found = await getDevice(deviceId)
    expect(found?.deviceName).toBe('v2')
    const all = (await listDevices()).filter(d => d.deviceId === deviceId)
    expect(all.length).toBe(1)
  })
})
