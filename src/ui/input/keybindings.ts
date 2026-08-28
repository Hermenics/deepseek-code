import type { DeepSeekSettings, KeybindingsSettings, KeybindingValue } from '../../settings/types.js'
import { loadMergedSettings } from '../../settings/loader.js'
import type { KeyEvent } from './hooks/useTextInput.js'

export const KEYBINDING_ACTIONS = [
  'submit', 'cancel', 'abort', 'exit', 'cursorStart', 'cursorEnd', 'cursorLeft', 'cursorRight',
  'cursorWordLeft', 'cursorWordRight', 'deleteBackward', 'deleteForward', 'deleteWordForward',
  'killToEnd', 'killToStart', 'killWordBackward', 'yank', 'historyUp', 'historyDown',
  'insertNewline', 'acceptCompletion', 'cycleMode', 'undo', 'redo',
] as const

export type KeybindingAction = typeof KEYBINDING_ACTIONS[number]
export type ResolvedKeybindings = Readonly<Record<KeybindingAction, readonly string[]>>

/** Defaults mirror the existing InputBox and useTextInput behavior. */
export const DEFAULT_KEYBINDINGS: ResolvedKeybindings = Object.freeze({
  submit: ['enter'],
  cancel: ['escape'],
  abort: ['ctrl+c'],
  exit: ['ctrl+d'],
  cursorStart: ['ctrl+a', 'home'],
  cursorEnd: ['ctrl+e', 'end'],
  cursorLeft: ['ctrl+b', 'left'],
  cursorRight: ['ctrl+f', 'right'],
  cursorWordLeft: ['alt+b'],
  cursorWordRight: ['alt+f'],
  deleteBackward: ['backspace'],
  deleteForward: ['delete'],
  deleteWordForward: ['alt+d'],
  killToEnd: ['ctrl+k'],
  killToStart: ['ctrl+u'],
  killWordBackward: ['ctrl+w'],
  yank: ['ctrl+y'],
  historyUp: ['up'],
  historyDown: ['down'],
  insertNewline: ['shift+enter'],
  acceptCompletion: ['tab'],
  cycleMode: ['shift+tab'],
  undo: ['ctrl+z'],
  redo: ['ctrl+shift+z'],
})

const KEY_ALIASES: Record<string, string> = {
  control: 'ctrl',
  esc: 'escape',
  return: 'enter',
  cmd: 'alt',
  command: 'alt',
  meta: 'alt',
  option: 'alt',
}

const NAMED_KEYS = new Set([
  'enter', 'escape', 'backspace', 'delete', 'tab', 'space', 'left', 'right', 'up', 'down',
  'home', 'end', 'pageup', 'pagedown',
  ...Array.from({ length: 12 }, (_, index) => `f${index + 1}`),
])

function isKeybindingAction(value: string): value is KeybindingAction {
  return (KEYBINDING_ACTIONS as readonly string[]).includes(value)
}

/** Return a canonical form, or undefined for malformed/unknown bindings. */
export function normalizeKeybinding(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined
  const parts = value.trim().toLowerCase().split('+').map(part => part.trim())
  const keyPart = parts.pop()
  if (!keyPart) return undefined
  const key = KEY_ALIASES[keyPart] ?? keyPart
  if (key.length !== 1 && !NAMED_KEYS.has(key)) return undefined
  if (key.length === 1 && key.charCodeAt(0) < 0x20) return undefined

  const modifiers = new Set<string>()
  for (const rawModifier of parts) {
    const modifier = KEY_ALIASES[rawModifier] ?? rawModifier
    if (!['ctrl', 'alt', 'shift'].includes(modifier)) return undefined
    modifiers.add(modifier)
  }
  return [...['ctrl', 'alt', 'shift'].filter(modifier => modifiers.has(modifier)), key].join('+')
}

function configuredBindings(value: KeybindingValue | undefined): readonly string[] | undefined {
  const values = typeof value === 'string' ? [value] : Array.isArray(value) ? value : []
  const valid = [...new Set(values.map(normalizeKeybinding).filter((binding): binding is string => binding !== undefined))]
  return valid.length > 0 ? valid : undefined
}

function settingsBindings(settings: DeepSeekSettings | undefined): KeybindingsSettings | undefined {
  return settings?.interface?.keybindings ?? settings?.keybindings
}

/** Merge valid configured bindings over defaults; invalid actions/keys fail closed to defaults. */
export function resolveKeybindings(overrides?: KeybindingsSettings): ResolvedKeybindings {
  const resolved = {} as Record<KeybindingAction, readonly string[]>
  const configured = new Map<KeybindingAction, readonly string[]>()
  const claimed = new Set<string>()
  for (const action of KEYBINDING_ACTIONS) {
    const bindings = overrides && isKeybindingAction(action) ? configuredBindings(overrides[action]) : undefined
    if (bindings) {
      configured.set(action, bindings)
      bindings.forEach(binding => claimed.add(binding))
    }
  }
  for (const action of KEYBINDING_ACTIONS) {
    resolved[action] = configured.get(action) ?? DEFAULT_KEYBINDINGS[action].filter(binding => !claimed.has(binding))
  }
  return resolved
}

export function keybindingsFromSettings(settings: DeepSeekSettings | undefined): ResolvedKeybindings {
  return resolveKeybindings(settingsBindings(settings))
}

export async function loadKeybindings(cwd?: string): Promise<ResolvedKeybindings> {
  return keybindingsFromSettings(await loadMergedSettings(cwd))
}

/** Convert a parsed input event without guessing unknown terminal sequences. */
export function keyEventToBinding(key: KeyEvent): string | undefined {
  const raw = key.raw && key.raw.length === 1 && key.raw.charCodeAt(0) >= 0x20 ? key.raw.toLowerCase() : undefined
  const keyName = key.name?.toLowerCase()
  const name = keyName && (KEY_ALIASES[keyName] ?? keyName)
  const keyPart = name && (name.length === 1 || NAMED_KEYS.has(name)) ? name : raw
  if (!keyPart) return undefined
  const modifiers = [
    key.ctrl ? 'ctrl' : undefined,
    key.meta || key.option ? 'alt' : undefined,
    key.shift ? 'shift' : undefined,
  ].filter((modifier): modifier is string => modifier !== undefined)
  return normalizeKeybinding([...modifiers, keyPart].join('+'))
}

/** Unknown keys return undefined so the caller can retain its normal text-input fallback. */
export function resolveKeybindingAction(key: KeyEvent, bindings?: ResolvedKeybindings): KeybindingAction | undefined {
  const normalized = keyEventToBinding(key)
  if (!normalized) return undefined
  const resolved = bindings ?? DEFAULT_KEYBINDINGS
  return KEYBINDING_ACTIONS.find(action => resolved[action].includes(normalized))
}

export function getKeybindingsForAction(action: string, bindings?: ResolvedKeybindings): readonly string[] {
  return isKeybindingAction(action) ? (bindings ?? DEFAULT_KEYBINDINGS)[action] : []
}
