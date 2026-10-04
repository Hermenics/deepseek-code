/**
 * Page snapshots for the model: Chrome's accessibility tree rendered as compact indented lines,
 * with short refs (`e12`) on elements the agent can act on, plus diffs between two snapshots.
 * Everything here is pure; the browser service feeds it `Accessibility.getFullAXTree` nodes.
 */

export interface AXValue { type?: string; value?: unknown }
export interface AXNode {
  nodeId: string
  ignored?: boolean
  role?: AXValue
  name?: AXValue
  value?: AXValue
  properties?: Array<{ name: string; value: AXValue }>
  childIds?: string[]
  parentId?: string
  backendDOMNodeId?: number
}

export interface SnapshotLine {
  /** Stable identity for diffing: the ref, or role+name(+occurrence) for lines without one. */
  key: string
  depth: number
  role: string
  ref?: string
  /** Accessible name, for role+name locators (test export). */
  name?: string
  text: string
}

export interface Snapshot {
  lines: SnapshotLine[]
  /** Lines left out because of the size cap. */
  omitted: number
}

/** Hands out `eN` refs per DOM node; the browser service keeps one per document so refs stay stable until navigation. */
export class RefTable {
  private readonly byNode = new Map<number, string>()
  private readonly byRef = new Map<string, number>()

  ref(backendNodeId: number): string {
    let ref = this.byNode.get(backendNodeId)
    if (!ref) {
      ref = `e${this.byNode.size + 1}`
      this.byNode.set(backendNodeId, ref)
      this.byRef.set(ref, backendNodeId)
    }
    return ref
  }

  /** DOM node behind a ref, or undefined for an unknown (stale or invented) ref. */
  node(ref: string): number | undefined {
    return this.byRef.get(ref)
  }
}

/** Roles the agent can act on; these get refs. */
const INTERACTIVE = new Set([
  'link', 'button', 'textbox', 'searchbox', 'combobox', 'listbox', 'option', 'checkbox', 'radio', 'switch',
  'slider', 'spinbutton', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'treeitem', 'textarea',
])
/** Landmarks and live regions kept even in interactive mode, for orientation. */
const CONTEXT = new Set(['heading', 'dialog', 'alertdialog', 'alert', 'status', 'navigation', 'main', 'form', 'banner', 'contentinfo', 'search'])
/** Wrappers that add nothing: their children are lifted to the parent's depth. */
const TRANSPARENT = new Set(['generic', 'none', 'presentation', 'group', 'LineBreak', 'InlineTextBox', 'RootWebArea', 'WebArea', 'Section', 'paragraph', 'list', 'listitem', 'ListMarker', 'strong', 'emphasis'])
// `focused` is left out: every click moves focus, and it would add two noise lines to each diff.
const STATES = ['disabled', 'checked', 'pressed', 'expanded', 'selected', 'required', 'invalid']
const VALUE_ROLES = new Set(['textbox', 'searchbox', 'combobox', 'slider', 'spinbutton', 'textarea'])
const MAX_DEPTH = 8

export const SNAPSHOT_MAX_CHARS = 20_000

function clip(value: string, max: number): string {
  const flat = value.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

function quote(value: string, max: number): string {
  return JSON.stringify(clip(value, max))
}

function describe(node: AXNode, role: string, ref: string | undefined): string {
  const name = typeof node.name?.value === 'string' ? node.name.value : ''
  const parts = [role]
  if (name) parts.push(quote(name, role === 'StaticText' || role === 'text' ? 300 : 100))
  const props = new Map((node.properties ?? []).map(prop => [prop.name, prop.value?.value]))
  if (role === 'heading' && props.get('level') !== undefined) parts.push(`[h${String(props.get('level'))}]`)
  if (ref) parts.push(`[${ref}]`)
  for (const state of STATES) {
    const value = props.get(state)
    if (value === true || value === 'true') parts.push(state)
    else if (state === 'checked' && (value === false || value === 'false')) parts.push('unchecked')
    else if (state === 'checked' && value === 'mixed') parts.push('mixed')
    else if (state === 'expanded' && (value === false || value === 'false')) parts.push('collapsed')
  }
  if (VALUE_ROLES.has(role) && node.value?.value !== undefined && node.value.value !== '') parts.push(`value=${quote(String(node.value.value), 80)}`)
  return parts.join(' ')
}

/**
 * Renders the tree from `rootNodeId` (the document, or a ref's subtree for `scope`). Interactive
 * mode keeps actionable elements plus headings/landmarks; full mode also keeps named text.
 * Ignored nodes (display:none, aria-hidden) are dropped.
 */
export function buildSnapshot(nodes: AXNode[], refs: RefTable, options: { mode?: 'interactive' | 'full'; rootBackendNodeId?: number; maxChars?: number } = {}): Snapshot {
  const byId = new Map(nodes.map(node => [node.nodeId, node]))
  const mode = options.mode ?? 'interactive'
  const maxChars = options.maxChars ?? SNAPSHOT_MAX_CHARS
  const root = options.rootBackendNodeId !== undefined
    ? nodes.find(node => node.backendDOMNodeId === options.rootBackendNodeId)
    : nodes.find(node => !node.parentId) ?? nodes[0]
  const lines: SnapshotLine[] = []
  const occurrences = new Map<string, number>()
  let chars = 0
  let omitted = 0

  const visit = (node: AXNode, depth: number, parentLabels: string[]): void => {
    const role = String(node.role?.value ?? '')
    const name = typeof node.name?.value === 'string' ? node.name.value.trim() : ''
    let childDepth = depth
    let childLabels = parentLabels
    if (!node.ignored) {
      const interactive = INTERACTIVE.has(role)
      // Text that only repeats its parent's name or value ("link Terms" → "Terms") adds nothing.
      const echo = role === 'StaticText' && parentLabels.includes(clip(name, 300))
      const keep = interactive || (CONTEXT.has(role) && (name || role === 'dialog' || role === 'alert'))
        || (mode === 'full' && name && !TRANSPARENT.has(role) && !echo)
        || ((role === 'image' || role === 'img') && name)
      if (keep) {
        const ref = interactive && node.backendDOMNodeId !== undefined ? refs.ref(node.backendDOMNodeId) : undefined
        const text = describe(node, role, ref)
        const base = ref ?? `${role}|${name}`
        const seen = occurrences.get(base) ?? 0
        occurrences.set(base, seen + 1)
        const line = { key: seen ? `${base}#${seen}` : base, depth: Math.min(depth, MAX_DEPTH), role, ref, name: name || undefined, text }
        const size = line.depth * 2 + text.length + 3
        if (chars + size > maxChars) omitted++
        else { lines.push(line); chars += size }
        childDepth = depth + 1
        childLabels = [clip(name, 300), ...(node.value?.value !== undefined ? [clip(String(node.value.value), 300)] : [])]
      }
    }
    // A named static text already carries its inline children's text.
    if (role === 'StaticText') return
    for (const childId of node.childIds ?? []) {
      const child = byId.get(childId)
      if (child) visit(child, childDepth, childLabels)
    }
  }
  if (root) visit(root, 0, [])
  return { lines, omitted }
}

/** Indented text of a snapshot, with an omission hint when it was capped. */
export function renderSnapshot(snapshot: Snapshot): string {
  const body = snapshot.lines.map(line => `${'  '.repeat(line.depth)}- ${line.text}`)
  if (snapshot.omitted) body.push(`… ${snapshot.omitted} more elements omitted (use snapshot with scope=<ref>, or find)`)
  return body.join('\n')
}

/** What changed between two snapshots of the same page: `+` added, `-` removed, `~` changed (keyed by ref, else role+name). */
export function diffSnapshots(before: Snapshot, after: Snapshot, maxLines = 40): string[] {
  const old = new Map(before.lines.map(line => [line.key, line]))
  const next = new Map(after.lines.map(line => [line.key, line]))
  const changes: string[] = []
  for (const line of after.lines) {
    const previous = old.get(line.key)
    if (!previous) changes.push(`+ ${line.text}`)
    else if (previous.text !== line.text) changes.push(`~ ${previous.text} → ${line.text}`)
  }
  for (const line of before.lines) if (!next.has(line.key)) changes.push(`- ${line.text}`)
  return changes.length > maxLines ? [...changes.slice(0, maxLines), `… ${changes.length - maxLines} more changes (take a snapshot)`] : changes
}

/** Snapshot lines whose text contains `query` (case-insensitive), optionally limited to one role. */
export function findLines(snapshot: Snapshot, query: string, role?: string): SnapshotLine[] {
  const needle = query.toLowerCase()
  return snapshot.lines.filter(line => (!role || line.role === role) && line.text.toLowerCase().includes(needle))
}

/**
 * Wraps page-derived text so the model treats it as data. The closing tag is neutralized inside
 * the body, so a page cannot end the envelope early and speak as the tool.
 */
export function wrapUntrusted(meta: { url: string; title?: string; tab?: number }, body: string): string {
  const attr = (value: string) => value.replace(/["<>]/g, '')
  const safeBody = body.replace(/<\/?untrusted-web/gi, match => match.replaceAll('<', '‹'))
  const title = meta.title ? ` title="${attr(clip(meta.title, 120))}"` : ''
  const tab = meta.tab !== undefined ? ` tab=${meta.tab}` : ''
  return `<untrusted-web url="${attr(meta.url)}"${title}${tab}>\n${safeBody}\n</untrusted-web>`
}

const SENSITIVE_AUTOCOMPLETE = /\b(cc-|current-password|new-password|one-time-code)/i
const SENSITIVE_NAME = /pass(word|wd|phrase)?\b|\bpwd\b|\botp\b|\bcvv\b|\bcvc\b|card.?(number|no)|\bpin\b|\bssn\b|secret|api.?key|token/i

/**
 * True for fields the agent must never fill: passwords, payment cards, one-time codes and
 * secrets, judged from the element's type, autocomplete hint and name/id/label.
 * `attributes` is CDP's flat `[name, value, name, value, …]` list.
 */
export function isSensitiveField(attributes: string[], accessibleName = ''): boolean {
  const attrs = new Map<string, string>()
  for (let i = 0; i + 1 < attributes.length; i += 2) attrs.set(attributes[i]!.toLowerCase(), attributes[i + 1]!)
  if ((attrs.get('type') ?? '').toLowerCase() === 'password') return true
  if (SENSITIVE_AUTOCOMPLETE.test(attrs.get('autocomplete') ?? '')) return true
  const labels = [attrs.get('name'), attrs.get('id'), attrs.get('aria-label'), attrs.get('placeholder'), accessibleName].filter(Boolean).join(' ')
  return SENSITIVE_NAME.test(labels)
}
