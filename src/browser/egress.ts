import { createHash, X509Certificate } from 'node:crypto'
import { createSecureContext, type SecureContext } from 'node:tls'
import { existsSync, rmSync, lstatSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { onExit } from 'signal-exit'
import { systemResolver, type Resolver } from './policy.js'
import { scrubbedEnv } from '../utils/platform.js'

export interface EgressCertificate { key: string; cert: string; spki: string; context: SecureContext }
export interface EgressLaunchOptions { proxyServer: string; proxyBypassList: string; certificateSPKI: string }
export type EgressAuthorizer = (url: string, socketOrigin?: string) => boolean | Promise<boolean>

/** Trust only this ephemeral key in Codimium, never install a host/browser CA. */
export async function createEgressCertificate(): Promise<EgressCertificate> {
  const directory = await mkdtemp(join(tmpdir(), 'deepseek-egress-cert-'))
  try {
    const keyPath = join(directory, 'key.pem'), certPath = join(directory, 'cert.pem')
    let process: ReturnType<typeof Bun.spawn>
    try {
      process = Bun.spawn(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=codimium.invalid', '-keyout', keyPath, '-out', certPath], { env: scrubbedEnv(), stdout: 'ignore', stderr: 'ignore' })
    } catch { throw new Error('Codimium network protection requires OpenSSL on this host') }
    if (await process.exited !== 0) throw new Error('Codimium could not create its private network certificate')
    const [key, cert] = await Promise.all([readFile(keyPath, 'utf8'), readFile(certPath, 'utf8')])
    const spki = createHash('sha256').update(new X509Certificate(cert).publicKey.export({ format: 'der', type: 'spki' })).digest('base64')
    return { key, cert, spki, context: createSecureContext({ key, cert }) }
  } finally { await rm(directory, { recursive: true, force: true }) }
}

let helperPath: Promise<string> | undefined
async function nodeHelper(): Promise<string> {
  const packaged = fileURLToPath(new URL('./browser-egress-worker.mjs', import.meta.url))
  if (existsSync(packaged)) return packaged
  helperPath ??= (async () => {
    const result = await Bun.build({ entrypoints: [fileURLToPath(new URL('./egressWorker.ts', import.meta.url))], target: 'node', format: 'esm', minify: true })
    if (!result.success) throw new Error('Codimium network helper could not be built')
    const directory = await mkdtemp(join(tmpdir(), 'deepseek-egress-helper-'))
    onExit(() => { try { rmSync(directory, { recursive: true, force: true }) } catch {} })
    const path = join(directory, 'helper.mjs')
    await writeFile(path, await result.outputs[0]!.text(), { mode: 0o600 })
    return path
  })()
  return helperPath
}

interface Ready { url: string; username: string; password: string; realm: string; cleanupDirectory?: string }
function cleanupProxyDirectory(path: string | undefined): void {
  if (!path || dirname(path) !== tmpdir() || !basename(path).startsWith('deepseek-egress-tls-')) return
  try {
    const info = lstatSync(path)
    if (info.isDirectory() && !info.isSymbolicLink() && (process.getuid?.() === undefined || info.uid === process.getuid!())) rmSync(path, { recursive: true, force: true })
  } catch { /* child already removed its private endpoint */ }
}
/** Native Node HTTP/TLS parser: Bun's HTTP server cannot accept a wrapped socket. */
export class BrowserEgress {
  private stopped = false
  private constructor(private process: Bun.Subprocess, private ready: Ready, private spki: string) {}
  get username(): string { return this.ready.username }
  get password(): string { return this.ready.password }
  get realm(): string { return this.ready.realm }
  get url(): string { return this.ready.url }
  launchOptions(): EgressLaunchOptions { return { proxyServer: this.url, proxyBypassList: '<-loopback>', certificateSPKI: this.spki } }
  stop(): void { if (!this.stopped) { this.stopped = true; try { this.process.kill() } catch { /* helper already exited */ } } }
  async whenStopped(): Promise<void> { await this.process.exited }

  static async start(certificate: EgressCertificate, authorize: EgressAuthorizer, resolve: Resolver = systemResolver, certificateAuthority?: string): Promise<BrowserEgress> {
    const node = Bun.which('node')
    if (!node) throw new Error('Codimium network protection requires Node.js 18 or newer')
    const helper = await nodeHelper()
    let ready: (value: Ready) => void = () => {}, failed: (error: Error) => void = () => {}
    const initialized = new Promise<Ready>((done, fail) => { ready = done; failed = fail })
    let cleanupDirectory: string | undefined
    const proc = Bun.spawn([node, helper], {
      env: { ...scrubbedEnv(), TMPDIR: tmpdir() }, stdin: 'ignore', stdout: 'ignore', stderr: 'ignore', serialization: 'json',
      ipc(message, child) {
        const reply = (id: number, result: unknown) => { try { child.send({ type: 'reply', id, value: result }) } catch { /* owner/helper closed during authorization */ } }
        const value = message as { type?: string; id?: number; url?: string; origin?: string; host?: string } & Ready
        if (value.type === 'ready') { cleanupDirectory = value.cleanupDirectory; ready(value); return }
        if (value.type === 'error') { failed(Error('Codimium network helper could not initialize')); return }
        if (value.type === 'authorize' && typeof value.id === 'number' && typeof value.url === 'string') {
          void Promise.resolve().then(() => authorize(value.url!, value.origin)).then(allowed => reply(value.id!, allowed === true)).catch(() => reply(value.id!, false))
        } else if (value.type === 'resolve' && typeof value.id === 'number' && typeof value.host === 'string') {
          void resolve(value.host).then(addresses => reply(value.id!, addresses)).catch(() => reply(value.id!, []))
        }
      },
    })
    const timer = setTimeout(() => failed(Error('Codimium network helper did not initialize')), 10_000)
    void proc.exited.then(() => { cleanupProxyDirectory(cleanupDirectory); failed(Error('Codimium network helper exited')) })
    proc.send({ type: 'init', key: certificate.key, cert: certificate.cert, spki: certificate.spki, certificateAuthority, customResolver: resolve !== systemResolver })
    try { return new BrowserEgress(proc, await initialized, certificate.spki) }
    catch (error) { proc.kill(); await proc.exited; throw error }
    finally { clearTimeout(timer) }
  }
}
