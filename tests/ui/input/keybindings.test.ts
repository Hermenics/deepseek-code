import { afterEach, describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Cursor } from '../../../src/ui/input/cursor/index.js'
import {
  DEFAULT_KEYBINDINGS,
  keyEventToBinding,
  keybindingsFromSettings,
  normalizeKeybinding,
  resolveKeybindingAction,
  loadKeybindings,
} from '../../../src/ui/input/keybindings.js'
import { validateSettings } from '../../../src/settings/repository.js'
import { processTextInputKey } from '../../../src/ui/input/hooks/useTextInput.js'

const temporary: string[] = []
afterEach(async () => { await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true }))) })

describe('keybindings', () => {
  it('keeps the existing editing defaults', () => {
    expect(resolveKeybindingAction({ ctrl: true, name: 'a' })).toBe('cursorStart')
    expect(resolveKeybindingAction({ meta: true, name: 'f' })).toBe('cursorWordRight')
    expect(resolveKeybindingAction({ name: 'return' })).toBe('submit')
    expect(DEFAULT_KEYBINDINGS.historyUp).toEqual(['up'])
  })

  it('normalizes aliases and rejects unknown terminal keys', () => {
    expect(normalizeKeybinding(' Control + Shift + Z ')).toBe('ctrl+shift+z')
    expect(normalizeKeybinding('ctrl+shift+z')).toBe('ctrl+shift+z')
    expect(normalizeKeybinding('meta+b')).toBe('alt+b')
    expect(keyEventToBinding({ name: 'unhandled-terminal-key' })).toBeUndefined()
    expect(resolveKeybindingAction({ name: 'unhandled-terminal-key' })).toBeUndefined()
  })

  it('falls back to defaults for malformed configured bindings', () => {
    const bindings = keybindingsFromSettings({
      interface: { keybindings: { cursorStart: 'ctrl+not-a-key', cursorEnd: 'home' } },
    })
    expect(bindings.cursorStart).toEqual(['ctrl+a'])
    expect(bindings.cursorEnd).toEqual(['home'])
    expect(resolveKeybindingAction({ name: 'home' }, bindings)).toBe('cursorEnd')

    const remapped = keybindingsFromSettings({ interface: { keybindings: { cursorEnd: 'home' } } })
    expect(resolveKeybindingAction({ name: 'home' }, remapped)).toBe('cursorEnd')
  })

  it('applies configured bindings in the text input path', () => {
    const result = processTextInputKey(
      Cursor.fromText('hello', 80, 5),
      { name: 'x', raw: 'x' },
      { keybindings: { cursorStart: 'x' } },
    )
    expect(result.type).toBe('cursor')
    if (result.type === 'cursor') expect(result.cursor.offset).toBe(0)
  })

  it('loads project bindings through the existing settings hierarchy', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'deepseek-keybindings-'))
    temporary.push(cwd)
    await mkdir(join(cwd, '.deepseek'), { recursive: true })
    await writeFile(join(cwd, '.deepseek', 'settings.json'), JSON.stringify({
      interface: { keybindings: { cursorStart: 'ctrl+x' } },
    }))

    const bindings = await loadKeybindings(cwd)
    expect(bindings.cursorStart).toEqual(['ctrl+x'])
  })

  it('rejects malformed binding values at the settings boundary', () => {
    expect(validateSettings({ interface: { keybindings: { submit: 42 as never } } })).toContainEqual(
      expect.objectContaining({ path: 'interface.keybindings.submit' }),
    )
  })

  it('leaves unknown keys on the normal printable-input fallback', () => {
    const result = processTextInputKey(Cursor.fromText('', 80), { name: 'q', raw: 'q' })
    expect(result).toMatchObject({ type: 'cursor' })
    if (result.type === 'cursor') expect(result.cursor.text).toBe('q')
  })
})
