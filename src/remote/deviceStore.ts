import { join } from 'node:path'
import { homedir } from 'node:os'
import { generateKeyPair } from '../../packages/remote-shared/src/crypto.js'

export interface TrustedDevice {
  deviceId: string
  deviceName: string
  publicKey: string
  sharedSecret: string
  pairedAt: number
  lastSeen: number
}

export interface DeviceStore {
  devices: TrustedDevice[]
  cliKeyPair: {
    publicKey: string
    secretKey: string
  }
}

const STORE_DIR = join(homedir(), '.deepseek-code')
const STORE_PATH = join(STORE_DIR, 'trusted-devices.json')

async function ensureDir(): Promise<void> {
  await Bun.spawn(['mkdir', '-p', STORE_DIR]).exited
}

async function readStore(): Promise<DeviceStore | null> {
  const file = Bun.file(STORE_PATH)
  if (!(await file.exists())) return null
  return file.json() as Promise<DeviceStore>
}

async function writeStore(store: DeviceStore): Promise<void> {
  await ensureDir()
  await Bun.write(STORE_PATH, JSON.stringify(store, null, 2))
  // chmod 600 — only owner can read/write
  await Bun.spawn(['chmod', '600', STORE_PATH]).exited
}

export async function load(): Promise<DeviceStore> {
  const existing = await readStore()
  if (existing) return existing
  // First run — generate CLI keypair
  const store: DeviceStore = { devices: [], cliKeyPair: generateKeyPair() }
  await writeStore(store)
  return store
}

export async function save(store: DeviceStore): Promise<void> {
  await writeStore(store)
}

export async function addDevice(device: TrustedDevice): Promise<void> {
  const store = await load()
  store.devices = store.devices.filter(d => d.deviceId !== device.deviceId)
  store.devices.push(device)
  await writeStore(store)
}

export async function removeDevice(deviceId: string): Promise<void> {
  const store = await load()
  store.devices = store.devices.filter(d => d.deviceId !== deviceId)
  await writeStore(store)
}

export async function getDevice(deviceId: string): Promise<TrustedDevice | null> {
  const store = await load()
  return store.devices.find(d => d.deviceId === deviceId) ?? null
}

export async function listDevices(): Promise<TrustedDevice[]> {
  const store = await load()
  return store.devices
}

export async function getOrCreateKeyPair(): Promise<{ publicKey: string; secretKey: string }> {
  const store = await load()
  return store.cliKeyPair
}
