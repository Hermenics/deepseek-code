import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { browserService, contextKey } from '../../src/browser/service.js'
import { runBrowser } from '../../src/tools/Browser/Browser.js'
import type { ToolExecutionContext } from '../../src/orchestration/types.js'
import type { PromptImage } from '../../src/types/input.js'
import { findChromium } from '../../src/utils/platform.js'

const canRun = Boolean(findChromium()) && process.platform !== 'win32'
let server: ReturnType<typeof Bun.serve>
let base = ''
const SESSION = `tool-e2e-${process.pid}`

const PAGE = `<!doctype html><title>Shop</title><main><h1>Cart</h1>
<label>Email <input id=email type=email></label>
<label>Password <input type=password name=password></label>
<button id=save onclick="document.getElementById('msg').textContent='Saved '+document.getElementById('email').value;console.error('audit log failed')">Save</button>
<button onclick="if (confirm('Delete everything?')) document.getElementById('msg').textContent='Deleted'">Delete</button>
<p id=msg></p><a href="/slow">Slow page</a></main><script>fetch('/api/missing')</script>`

const LOGIN = `<!doctype html><title>Login</title><button onclick="fetch('/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({teamCode:'blue-7'})})">Log in</button>`

const UPLOAD = `<!doctype html><title>Upload</title><label>CV <input id=f type=file onchange="out.textContent='got '+f.files[0].name+' '+f.files[0].size"></label><p id=out></p>`

const EMULATE = `<!doctype html><meta name=viewport content="width=device-width"><title>Viewport</title><p id=w></p><script>
const show = () => { w.textContent = 'width ' + innerWidth + ' ' + (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') }
show(); addEventListener('resize', show); matchMedia('(prefers-color-scheme: dark)').addEventListener('change', show)</script>`

beforeAll(() => {
  server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
    const path = new URL(request.url).pathname
    if (path === '/slow') return new Promise<Response>(() => {})
    if (path === '/favicon.ico') return new Response('', { status: 404 })
    if (path === '/report.csv') return new Response('id,total\n1,42\n', { headers: { 'content-type': 'text/csv', 'content-disposition': 'attachment; filename="report.csv"' } })
    if (path === '/late') return new Response('<!doctype html><title>Late</title><p>ok</p><script>setTimeout(() => console.error("TypeError: x is undefined (after HMR)"), 400)</script>', { headers: { 'content-type': 'text/html' } })
    if (path === '/export') return new Response('<!doctype html><title>Export</title><a href="/report.csv">Export CSV</a>', { headers: { 'content-type': 'text/html' } })
    if (path === '/upload') return new Response(UPLOAD, { headers: { 'content-type': 'text/html' } })
    if (path === '/emulate') return new Response(EMULATE, { headers: { 'content-type': 'text/html' } })
    if (path === '/login') return new Response(LOGIN, { headers: { 'content-type': 'text/html' } })
    if (path.startsWith('/api/')) return Response.json({ error: 'not found' }, { status: 404 })
    return new Response(PAGE, { headers: { 'content-type': 'text/html' } })
  } })
  base = `http://localhost:${server.port}`
})
afterAll(() => { browserService.releaseSession(SESSION); server.stop(true) })

const ctx = (extra: Partial<ToolExecutionContext> = {}) => ({ sessionId: SESSION, ...extra }) as ToolExecutionContext
const run = (args: Record<string, unknown>, extra?: Partial<ToolExecutionContext>) => runBrowser(args, ctx(extra))

describe.skipIf(!canRun)('browser tool end to end', () => {
  it('opens a page, acts on it, reports changes and errors, and refuses sensitive fields', async () => {
    const opened = await run({ action: 'navigate', url: `${base}/` })
    expect(opened).toStartWith(`Opened ${base}/ — "Shop"`)
    expect(opened).toContain('textbox "Email" [e1]')
    expect(opened).toContain('<untrusted-web')

    const typed = await run({ action: 'type', ref: 'e1', text: 'ana@example.com' })
    expect(typed).toContain('Typed 15 characters into e1')
    expect(typed).toContain('value="ana@example.com"')

    const refused = await run({ action: 'type', ref: 'e2', text: 'hunter2' })
    expect(refused).toStartWith('Error: e2 looks like a password')

    const clicked = await run({ action: 'click', ref: 'e3' })
    expect(clicked).toContain('+ StaticText "Saved ana@example.com"')
    expect(clicked).toMatch(/⚠ \d+ new console\/network errors?:\n<untrusted-web/)
    expect(clicked).toContain('[error] audit log failed')

    const logs = await run({ action: 'logs' })
    expect(logs).toContain('[error] audit log failed')
    expect(logs).toContain('404 GET')
    expect(await run({ action: 'network', failedOnly: true })).toContain('/api/missing')
  }, 60_000)

  it('runs a batch with expectations and stops at the first failure', async () => {
    await run({ action: 'navigate', url: `${base}/` })
    const passed = await run({ action: 'batch', steps: [
      { action: 'type', ref: 'e1', text: 'bo@example.com' },
      { action: 'click', ref: 'e3' },
      { action: 'expect', text: 'Saved bo@example.com' },
    ] })
    expect(passed).toStartWith('Batch: 3 steps done')
    expect(passed).toContain('3. ✓ PASS: text "Saved bo@example.com" present')
    const failed = await run({ action: 'batch', steps: [{ action: 'expect', text: 'Never shown', timeoutMs: 300 }, { action: 'click', ref: 'e3' }] })
    expect(failed).toStartWith('Error: batch stopped at step 1 of 2')
    expect(failed).not.toContain('2. ')
  }, 60_000)

  it('handles dialogs, blocked schemes, screenshots, tabs, interruption and close', async () => {
    await run({ action: 'navigate', url: `${base}/` })
    const confirmOpen = await run({ action: 'click', ref: 'e4' })
    expect(confirmOpen).toContain('A confirm dialog is open; answer it with dialog')
    expect(confirmOpen).toMatch(/<untrusted-web[^>]*>\nDelete everything\?\n<\/untrusted-web>/)
    expect(await run({ action: 'click', ref: 'e3' })).toStartWith('Error: A confirm dialog is open')
    expect(await run({ action: 'dialog', accept: true })).toContain('+ StaticText "Deleted"')

    expect(await run({ action: 'navigate', url: 'file:///etc/passwd' })).toStartWith('Error: Blocked: file: URLs are not allowed')
    expect(await run({ action: 'navigate', url: 'http://169.254.169.254/latest/meta-data/' })).toStartWith('Error: Blocked')

    expect(await run({ action: 'screenshot' })).toStartWith('Error: The current model does not accept images')
    const images: PromptImage[] = []
    expect(await run({ action: 'screenshot' }, { attachImage: image => images.push(image) })).toContain('attached for your next step')
    expect(images[0]?.mediaType).toBe('image/jpeg')

    expect(await run({ action: 'tabs', op: 'new' })).toContain('Opened tab 1')
    expect(await run({ action: 'tabs' })).toContain('* 1 about:blank')
    await run({ action: 'tabs', op: 'select', index: 0 })

    const controller = new AbortController()
    setTimeout(() => controller.abort(), 300)
    expect(await run({ action: 'navigate', url: `${base}/slow` }, { signal: controller.signal })).toStartWith('Cancelled: browser navigate was interrupted')

    expect(await run({ action: 'close' })).toBe('Closed the browser for this session.')
    expect(browserService.status().contexts.some(context => context.key.startsWith(SESSION))).toBe(false)
  }, 60_000)

  it('ignores a missing favicon and shows what a request sent', async () => {
    const opened = await run({ action: 'navigate', url: `${base}/login` })
    expect(opened).not.toContain('new console/network error')
    const clicked = await run({ action: 'click', ref: 'e1' })
    expect(clicked).toMatch(/⚠ 1 new console\/network error/)
    const id = (await run({ action: 'network', filter: '/api/login' })).match(/^(\S+) POST 404/m)?.[1]
    expect(id).toBeDefined()
    const detail = await run({ action: 'network', id })
    expect(detail).toContain('Request body:\n{\n  "teamCode": "blue-7"\n}')
    expect(detail).toContain('Response body:')
  }, 60_000)

  it('hands off only with a reason and someone to take over', async () => {
    expect(await run({ action: 'handoff' })).toStartWith('Error: handoff needs a reason')
    expect(await run({ action: 'handoff', reason: 'log in' })).toStartWith('Error: no one can take over')
    expect(await run({ action: 'batch', steps: [{ action: 'handoff', reason: 'log in' }] })).toContain('handoff cannot be a batch step')
  })

  it('emulates a phone viewport and a dark color scheme', async () => {
    expect(await run({ action: 'navigate', url: `${base}/emulate` })).toContain('width 1280 light')
    const phone = await run({ action: 'emulate', device: 'mobile', colorScheme: 'dark' })
    expect(phone).toStartWith('Emulating mobile viewport 390×844 with touch and dark color scheme')
    expect(phone).toContain('width 390 dark')
    expect(await run({ action: 'emulate', device: 'desktop' })).toContain('width 1280 dark')
    expect(await run({ action: 'emulate' })).toStartWith('Error: emulate needs')
  }, 60_000)

  it('exports the recorded steps as a Playwright test with role and name locators', async () => {
    await run({ action: 'close' })
    await run({ action: 'navigate', url: `${base}/` })
    await run({ action: 'type', ref: 'e1', text: "o'neil@example.com" })
    await run({ action: 'batch', steps: [{ action: 'click', ref: 'e3' }, { action: 'expect', text: "Saved o'neil@example.com" }] })
    const exported = await run({ action: 'export', title: 'saves the email' })
    expect(exported).toContain("test('saves the email', async ({ page }) => {")
    expect(exported).toContain(`await page.goto('${base}/')`)
    expect(exported).toContain("await page.getByRole('textbox', { name: 'Email', exact: true }).fill('o\\'neil@example.com')")
    expect(exported).toContain("await page.getByRole('button', { name: 'Save', exact: true }).click()")
    expect(exported).toContain("await expect(page.getByText('Saved o\\'neil@example.com').first()).toBeVisible()")
    const code = exported.slice(exported.indexOf('import '))
    expect(() => new Bun.Transpiler({ loader: 'ts' }).transformSync(code)).not.toThrow()
    await run({ action: 'close' })
    expect(await run({ action: 'export' })).toStartWith('Error: nothing recorded yet')
  }, 60_000)

  it('uploads workspace files into a file input and nothing from outside', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'deepseek-upload-'))
    try {
      await mkdir(join(workspace, 'fixtures'))
      await writeFile(join(workspace, 'fixtures', 'cv.txt'), 'hello world')
      const inWorkspace = { workspacePath: workspace, projectRoot: workspace }
      const opened = await run({ action: 'navigate', url: `${base}/upload` })
      const ref = opened.match(/button "CV" \[(e\d+)\]/)?.[1] ?? opened.match(/"CV" \[(e\d+)\]/)?.[1]
      expect(ref).toBeDefined()
      const attached = await run({ action: 'upload', ref, paths: ['fixtures/cv.txt'] }, inWorkspace)
      expect(attached).toStartWith(`Attached 1 file to ${ref}: fixtures/cv.txt`)
      expect(attached).toContain('got cv.txt 11')
      expect(await run({ action: 'upload', ref, paths: ['/etc/passwd'] }, inWorkspace)).toStartWith('Error:')
      expect(await run({ action: 'upload', ref, paths: ['fixtures'] }, inWorkspace)).toStartWith('Error: fixtures is not a file')
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  }, 60_000)

  it('downloads into a private folder and reports where', async () => {
    await run({ action: 'navigate', url: `${base}/export` })
    let result = await run({ action: 'click', ref: 'e1' })
    for (let i = 0; i < 20 && !result.includes('Downloaded'); i++) result = await run({ action: 'wait', timeoutMs: 100, text: 'never-there' })
    const saved = result.match(/Downloaded "report\.csv" \(1 KB\) from \S+ to (\S+);/)?.[1]
    expect(saved).toBeDefined()
    expect(saved).toContain('deepseek-downloads-')
    expect(await readFile(saved!, 'utf8')).toBe('id,total\n1,42\n')
    await run({ action: 'close' })
    expect(await readFile(saved!, 'utf8').catch(() => 'deleted')).toBe('deleted')
  }, 60_000)

  it('labels interactive elements with their refs on a screenshot, and removes the overlay', async () => {
    const images: string[] = []
    await run({ action: 'navigate', url: `${base}/` })
    const shot = await run({ action: 'screenshot', marks: true }, { attachImage: image => { images.push(image.data) } })
    expect(shot).toMatch(/Screenshot of the viewport with \d+ elements labeled by ref/)
    expect(images).toHaveLength(1)
    expect(await run({ action: 'screenshot', marks: true, fullPage: true }, { attachImage: () => {} })).toStartWith('Error: marks work on viewport screenshots only')
    const after = await run({ action: 'snapshot' })
    expect(after).not.toContain('e1\n')
    expect(after).toContain('textbox "Email" [e1]')
    expect(await run({ action: 'find', query: 'Save' })).toContain('button "Save" [e3]')
  }, 60_000)

  it('reports errors the page logged between turns, once', async () => {
    expect(await run({ action: 'navigate', url: `${base}/late` })).not.toContain('TypeError')
    await Bun.sleep(800)
    const note = browserService.takeIdleErrors(contextKey(SESSION))
    expect(note).toStartWith('1 new console/network error on the open page since your last browser call:\n<untrusted-web')
    expect(note).toContain('[error] TypeError: x is undefined (after HMR)')
    expect(browserService.takeIdleErrors(contextKey(SESSION))).toBeUndefined()
  }, 60_000)
})
