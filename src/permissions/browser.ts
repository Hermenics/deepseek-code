/**
 * How a `browser` call is gated. Reading an already-approved page needs no prompt; navigating
 * needs the origin approved; acting on a public page needs a separate interaction approval;
 * typing into a public page asks every time, because it sends that text to the site.
 */
export type BrowserActionKind = 'read' | 'navigate' | 'interact' | 'type'

const INTERACT = new Set(['click', 'select', 'check', 'press', 'drag'])
const RANK: Record<BrowserActionKind, number> = { read: 0, navigate: 1, interact: 2, type: 3 }

function stepKind(step: Record<string, unknown>): BrowserActionKind {
  const action = String(step.action ?? '')
  if (action === 'navigate') return 'navigate'
  // Uploading sends file contents to the page, like typing sends text.
  if (action === 'type' || action === 'upload') return 'type'
  if (action === 'dialog') return step.accept !== true ? 'read' : typeof step.text === 'string' && step.text.length > 0 ? 'type' : 'interact'
  return INTERACT.has(action) ? 'interact' : 'read'
}

/** The strongest kind in the call (a batch is as strong as its strongest step). */
export function browserActionKind(args: Record<string, unknown>): BrowserActionKind {
  if (args.action !== 'batch' || !Array.isArray(args.steps)) return stepKind(args)
  return args.steps.reduce<BrowserActionKind>((strongest, step) => {
    const kind = step && typeof step === 'object' ? stepKind(step as Record<string, unknown>) : 'read'
    return RANK[kind] > RANK[strongest] ? kind : strongest
  }, 'read')
}

/** Origin of a URL, or undefined for unparsable and opaque (about:, data:) URLs. */
export function originOf(url: unknown): string | undefined {
  if (typeof url !== 'string') return undefined
  try {
    const origin = new URL(url).origin
    return origin === 'null' ? undefined : origin
  } catch {
    return undefined
  }
}

/** True for http(s) origins on this machine (localhost, *.localhost, 127.0.0.0/8, ::1). */
export function isLoopbackOrigin(origin: string): boolean {
  try {
    const host = new URL(origin).hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase()
    return host === 'localhost' || host.endsWith('.localhost') || /^127\./.test(host) || host === '::1'
  } catch {
    return false
  }
}

/**
 * The page a call acts on: the navigation URL, or the active tab's origin the agent injected as
 * `__origin` before the permission check.
 */
export function browserTarget(args: Record<string, unknown>): string | undefined {
  if (args.action === 'navigate' && typeof args.url === 'string') return args.url
  return typeof args.__origin === 'string' ? args.__origin : undefined
}

/** Session-approval key: `browser@origin` to navigate/read, `browser:interact@origin` to act on a public page. */
export function browserApprovalKey(args: Record<string, unknown>): string {
  const origin = originOf(browserTarget(args))
  if (!origin) return 'browser'
  const kind = browserActionKind(args)
  return (kind === 'interact' || kind === 'type') && !isLoopbackOrigin(origin) ? `browser:interact@${origin}` : `browser@${origin}`
}
