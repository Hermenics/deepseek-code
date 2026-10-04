import { describe, expect, it } from 'bun:test'
import { BrowserService, contextKey } from '../../src/browser/service.js'
import { launchBrowser } from '../../src/browser/launcher.js'
import { findChromium } from '../../src/utils/platform.js'

const canRun = Boolean(findChromium()) && process.platform !== 'win32'
const kinds = ['inherited', 'sandboxed', 'data', 'cross-site', 'reused-data']
const transports = ['fetch', 'image']

function probeDocument(base: string, kind: string, transport: string): string {
  const destination = JSON.stringify(`${base}/probe?kind=${kind}-${transport}&transport=${transport}`)
  const probe = transport === 'fetch'
    ? `fetch(${destination},{mode:'no-cors'}).then(()=>false,()=>true)`
    : `new Promise(resolve=>{const image=new Image();image.onload=()=>resolve(false);image.onerror=()=>resolve(true);image.src=${destination};})`
  return `<!doctype html><script>${probe}.then(denied=>parent.postMessage({kind:${JSON.stringify(kind)},transport:${JSON.stringify(transport)},denied},'*'))<` + '/script>'
}

describe.skipIf(!canRun)('Browser frame network ownership', () => {
  it('keeps opaque frames from inheriting a local top page network privilege', async () => {
    const hits = new Map<string, number>()
    let base = ''
    const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
      const url = new URL(request.url)
      if (url.pathname === '/probe') {
        const kind = url.searchParams.get('kind')!
        hits.set(kind, (hits.get(kind) ?? 0) + 1)
        if (url.searchParams.get('transport') === 'image') return new Response(Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'), { headers: { 'content-type': 'image/gif', 'cache-control': 'no-store' } })
        return new Response('owned probe', { headers: { 'cache-control': 'no-store' } })
      }
      if (url.pathname === '/frame') return new Response(probeDocument(base, url.searchParams.get('kind')!, url.searchParams.get('transport')!), { headers: { 'content-type': 'text/html' } })
      return new Response('<!doctype html><title>Frame policy</title>', { headers: { 'content-type': 'text/html' } })
    } })
    base = `http://localhost:${server.port}`
    const crossBase = `http://127.0.0.1:${server.port}`
    const expression = `(async () => {
      const results = [];
      const retained = new Map();
      const probeDocument = ${probeDocument.toString()};
      for (const kind of ${JSON.stringify(kinds)}) for (const transport of ${JSON.stringify(transports)}) {
        results.push(await new Promise((resolve, reject) => {
          const frame = kind === 'reused-data' ? retained.get(transport) : document.createElement('iframe');
          if (kind === 'inherited') retained.set(transport, frame);
          const timer = setTimeout(() => { frame.remove(); window.removeEventListener('message', receive); reject(Error(kind + ' frame timed out')); }, 5000);
          const receive = event => {
            if (event.source !== frame.contentWindow || event.data?.kind !== kind || event.data.transport !== transport) return;
            clearTimeout(timer); window.removeEventListener('message', receive);
            if (kind !== 'inherited') frame.remove();
            resolve({kind, transport, origin: event.origin, denied: event.data.denied});
          };
          window.addEventListener('message', receive);
          const html = probeDocument(${JSON.stringify(base)}, kind, transport);
          if (kind === 'sandboxed') frame.sandbox = 'allow-scripts';
          if (kind === 'data' || kind === 'reused-data') { frame.removeAttribute('srcdoc'); frame.src = 'data:text/html,' + encodeURIComponent(html); }
          else if (kind === 'cross-site') frame.src = ${JSON.stringify(crossBase)} + '/frame?kind=' + kind + '&transport=' + transport;
          else frame.srcdoc = html;
          if (!frame.isConnected) document.body.append(frame);
        }));
      }
      return results;
    })()`
    const evaluate = async (cdp: ReturnType<typeof launchBrowser>['connection'], session: string) => {
      const result = await cdp.send<{ result: { value?: unknown }; exceptionDetails?: unknown }>('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, session)
      expect(result.exceptionDetails).toBeUndefined()
      return result.result.value
    }
    const iframeTargets = new Set<string>()
    const control = launchBrowser(), service = new BrowserService((visible, network) => {
      const browser = launchBrowser({ visible, ...network })
      browser.connection.on('Target.attachedToTarget', params => { const info = params.targetInfo as { type: string; targetId: string }; if (info.type === 'iframe') iframeTargets.add(info.targetId) })
      return browser
    }), key = contextKey('opaque-frame')
    try {
      // Native Chrome without our request gate proves every fixture route is
      // reachable from the exact same browser/frame configuration.
      const target = await control.connection.send<{ targetId: string }>('Target.createTarget', { url: 'about:blank' })
      const session = await control.connection.send<{ sessionId: string }>('Target.attachToTarget', { targetId: target.targetId, flatten: true })
      await control.connection.send('Page.enable', {}, session.sessionId)
      await control.connection.send('Page.navigate', { url: base }, session.sessionId)
      const deadline = Date.now() + 5000
      while (Date.now() < deadline) {
        const ready = await control.connection.send<{ result: { value?: boolean } }>('Runtime.evaluate', { expression: `location.href === ${JSON.stringify(base + '/')} && document.readyState === 'complete'`, returnByValue: true }, session.sessionId)
        if (ready.result.value) break
        await Bun.sleep(20)
      }
      const expected = (protectedBrowser: boolean) => kinds.flatMap(kind => transports.map(transport => ({
        kind, transport, origin: kind === 'inherited' ? base : kind === 'cross-site' ? crossBase : 'null',
        denied: protectedBrowser && kind !== 'inherited' && kind !== 'cross-site',
      })))
      expect(await evaluate(control.connection, session.sessionId)).toEqual(expected(false))
      expect(hits.size).toBe(10)
      expect([...hits.values()].every(count => count === 1)).toBe(true)
      control.kill(); await control.exited; hits.clear()
      await service.withTab(key, async () => {})
      service.approve(key, base)
      await service.withTab(key, tab => tab.navigate(base))
      const actual = await service.withTab(key, tab => evaluate(tab.cdp, tab.sessionId))
      expect(actual).toEqual(expected(true))
      for (const kind of kinds) for (const transport of transports) expect(hits.get(`${kind}-${transport}`) ?? 0).toBe(kind === 'inherited' || kind === 'cross-site' ? 1 : 0)
      expect(iframeTargets.size).toBeGreaterThan(0)
      expect(service.status().running).toBe(true)
    } finally { control.kill(); await control.exited; await service.shutdown(); await service.whenClosed(); server.stop(true) }
  }, 30_000)
})
