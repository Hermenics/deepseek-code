import { describe, expect, it } from 'bun:test'
import { resolvePromptEditor } from '../src/ui/setup/promptEditor.js'

describe('prompt editor fallback', () => {
  it('prefers configured editor, then a blocking terminal or operating-system editor', () => {
    expect(resolvePromptEditor('code --wait', true, 'linux')).toBe('code --wait')
    expect(resolvePromptEditor(undefined, true, 'linux')).toBe('nano')
    expect(resolvePromptEditor(undefined, false, 'win32')).toBe('notepad.exe')
    expect(resolvePromptEditor(undefined, false, 'darwin')).toBe('open -W -t')
    expect(resolvePromptEditor(undefined, false, 'linux', true)).toBe('vi')
    expect(() => resolvePromptEditor(undefined, false, 'linux')).toThrow('blocking prompt editor')
  })
})
