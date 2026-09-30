import type { Tab } from './tab.js'

/** One user-visible step of a browser session, located by role and accessible name like a Playwright test would. */
export interface RecordedStep {
  action: string
  url?: string
  role?: string
  name?: string
  value?: string
  key?: string
  text?: string
  gone?: boolean
  checked?: boolean
}

const MAX_STEPS = 500
const recordings = new Map<string, RecordedStep[]>()

/** Role and name of a ref from the snapshots the model has seen (read before the action, which may remove it). */
export function locatorOf(tab: Tab, ref: unknown): { role: string; name?: string } | undefined {
  if (typeof ref !== 'string') return undefined
  const line = tab.lastSnapshot?.lines.find(item => item.ref === ref) ?? tab.baseline?.lines.find(item => item.ref === ref)
  return line ? { role: line.role, name: line.name } : undefined
}

/** The step a successful action adds, or null for reads that a test does not replay. */
export function stepFor(action: string, args: Record<string, unknown>, target?: { role: string; name?: string }, url?: string): RecordedStep | null {
  const str = (value: unknown) => typeof value === 'string' ? value : undefined
  switch (action) {
    case 'navigate': return { action, url: str(args.url) }
    case 'back': case 'forward': case 'reload': return { action }
    case 'click': case 'hover': return target ? { action, ...target } : { action: 'comment', text: `${action} at a point (${args.x}, ${args.y}) on ${url}` }
    case 'type': return target ? { action, ...target, value: str(args.text), key: args.submit === true ? 'Enter' : undefined } : null
    case 'select': return target ? { action, ...target, value: str(args.value) } : null
    case 'check': return target ? { action, ...target, checked: args.checked !== false } : null
    case 'upload': return target && Array.isArray(args.paths) ? { action, ...target, value: args.paths.join('\n') } : null
    case 'press': return { action, key: str(args.key) }
    case 'wait': case 'expect':
      if (str(args.text)) return { action: 'expect', text: str(args.text), gone: args.gone === true }
      if (str(args.url)) return { action: 'expect', url: str(args.url) }
      return target ? { action: 'expect', ...target, gone: args.gone === true } : null
    case 'handoff': return { action: 'comment', text: `the user acted here: ${str(args.reason) ?? ''}` }
    default: return null
  }
}

export function record(key: string, step: RecordedStep | null): void {
  if (!step) return
  const steps = recordings.get(key) ?? []
  steps.push(step)
  if (steps.length > MAX_STEPS) steps.shift()
  recordings.set(key, steps)
}

export function recorded(key: string): RecordedStep[] {
  return recordings.get(key) ?? []
}

export function clearRecording(key: string): void {
  recordings.delete(key)
}

/** ARIA roles getByRole accepts; Chrome's internal roles (StaticText, LabelText…) are not among them. */
const ARIA_ROLES = new Set(['button', 'checkbox', 'combobox', 'link', 'listbox', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'radio', 'searchbox', 'slider', 'spinbutton', 'switch', 'tab', 'textbox', 'treeitem', 'heading', 'img', 'dialog', 'alert', 'cell', 'row', 'navigation'])

const quote = (value: string) => `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`

function locator(step: RecordedStep): string | null {
  if (!step.role || !ARIA_ROLES.has(step.role)) return step.name ? `page.getByText(${quote(step.name)}, { exact: true })` : null
  return `page.getByRole(${quote(step.role)}${step.name ? `, { name: ${quote(step.name)}, exact: true }` : ''})`
}

/** A Playwright test that replays the recorded steps. */
export function exportPlaywright(steps: RecordedStep[], title = 'recorded browser flow'): string {
  const body: string[] = []
  for (const step of steps) {
    const target = locator(step)
    const needsTarget = ['click', 'hover', 'type', 'select', 'check', 'upload'].includes(step.action)
    if (needsTarget && !target) { body.push(`  // ${step.action}: the element had no role or accessible name to locate it by`); continue }
    switch (step.action) {
      case 'navigate': body.push(`  await page.goto(${quote(step.url ?? '')})`); break
      case 'back': body.push('  await page.goBack()'); break
      case 'forward': body.push('  await page.goForward()'); break
      case 'reload': body.push('  await page.reload()'); break
      case 'click': body.push(`  await ${target}.click()`); break
      case 'hover': body.push(`  await ${target}.hover()`); break
      case 'type':
        body.push(`  await ${target}.fill(${quote(step.value ?? '')})`)
        if (step.key) body.push(`  await ${target}.press('Enter')`)
        break
      case 'select': body.push(`  await ${target}.selectOption(${quote(step.value ?? '')})`); break
      case 'check': body.push(`  await ${target}.${step.checked ? 'check' : 'uncheck'}()`); break
      case 'upload': body.push(`  await ${target}.setInputFiles([${(step.value ?? '').split('\n').map(quote).join(', ')}])`); break
      case 'press': body.push(`  await page.keyboard.press(${quote(step.key ?? '')})`); break
      case 'expect':
        if (step.url) body.push(`  await expect(page).toHaveURL(new RegExp(${quote(step.url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))}))`)
        else {
          const what = step.text ? `page.getByText(${quote(step.text)})` : target
          if (what) body.push(`  await expect(${what}${step.text ? '.first()' : ''}).${step.gone ? 'toBeHidden' : 'toBeVisible'}()`)
        }
        break
      case 'comment': body.push(`  // ${step.text}`); break
    }
  }
  return [`import { test, expect } from '@playwright/test'`, '', `test(${quote(title)}, async ({ page }) => {`, ...body, '})', ''].join('\n')
}
