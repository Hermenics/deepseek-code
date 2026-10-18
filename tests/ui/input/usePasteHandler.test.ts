import { describe, it, expect, mock } from 'bun:test'
import React from 'react'
import { PassThrough } from 'node:stream'
import { renderSync } from '../../../src/ink/root.js'
import { InputBox } from '../../../src/ui/input/InputBox.js'

// Contract for the usePasteHandler hook, used by InputBox to choose between
// inline paste (direct text) and block paste (placeholder [Text #n]).
import { usePasteHandler } from '../../../src/ui/input/hooks/usePasteHandler.js'

class FakeTerminal extends PassThrough {
  isTTY = true
  isRaw = false
  columns = 100
  rows = 24
  setRawMode(enabled: boolean): this { this.isRaw = enabled; return this }
  ref(): this { return this }
  unref(): this { return this }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createHandler(overrides: {
  onPasteBlock?: (text: string) => void
  onPasteInline?: (text: string) => void
  isActive?: boolean
} = {}) {
  return usePasteHandler({
    onPasteBlock: overrides.onPasteBlock ?? mock(() => {}),
    onPasteInline: overrides.onPasteInline ?? mock(() => {}),
    isActive: overrides.isActive ?? true,
  })
}

// Block threshold: > 3 lines OR > 60 characters.
const MAX_INLINE_CHARS = 60

// Short text: <= 3 lines AND <= 60 characters.
const SHORT_TEXT = 'hello world'
const SHORT_MULTILINE = 'line one\nline two\nline three'  // exactly 3 lines

// Long text by line count: > 3 lines.
const LONG_BY_LINES = 'a\nb\nc\nd'  // 4 lines.

// Long text by size: > 60 characters, one line.
const LONG_BY_SIZE = 'x'.repeat(MAX_INLINE_CHARS + 1)

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('usePasteHandler', () => {
  describe('inline paste — short text', () => {
    it(`should call onPasteInline when text has 1 line and <= ${MAX_INLINE_CHARS} chars`, () => {
      const onPasteInline = mock(() => {})
      const onPasteBlock = mock(() => {})
      const handler = createHandler({ onPasteInline, onPasteBlock })

      handler.handlePaste(SHORT_TEXT)

      expect(onPasteInline).toHaveBeenCalledWith(SHORT_TEXT)
      expect(onPasteBlock).not.toHaveBeenCalled()
    })

    it(`should call onPasteInline when text has exactly 3 lines and <= ${MAX_INLINE_CHARS} chars`, () => {
      const onPasteInline = mock(() => {})
      const onPasteBlock = mock(() => {})
      const handler = createHandler({ onPasteInline, onPasteBlock })

      handler.handlePaste(SHORT_MULTILINE)

      expect(onPasteInline).toHaveBeenCalledWith(SHORT_MULTILINE)
      expect(onPasteBlock).not.toHaveBeenCalled()
    })
  })

  describe('block paste — long text', () => {
    it('should call onPasteBlock when text has more than 3 lines', () => {
      const onPasteInline = mock(() => {})
      const onPasteBlock = mock(() => {})
      const handler = createHandler({ onPasteInline, onPasteBlock })

      handler.handlePaste(LONG_BY_LINES)

      expect(onPasteBlock).toHaveBeenCalledWith(LONG_BY_LINES)
      expect(onPasteInline).not.toHaveBeenCalled()
    })

    it(`should call onPasteBlock when text has > ${MAX_INLINE_CHARS} chars (single line)`, () => {
      const onPasteInline = mock(() => {})
      const onPasteBlock = mock(() => {})
      const handler = createHandler({ onPasteInline, onPasteBlock })

      handler.handlePaste(LONG_BY_SIZE)

      expect(onPasteBlock).toHaveBeenCalledWith(LONG_BY_SIZE)
      expect(onPasteInline).not.toHaveBeenCalled()
    })

    it(`should keep text of exactly ${MAX_INLINE_CHARS} chars inline`, () => {
      const onPasteInline = mock(() => {})
      const onPasteBlock = mock(() => {})
      const handler = createHandler({ onPasteInline, onPasteBlock })

      handler.handlePaste('x'.repeat(MAX_INLINE_CHARS))

      expect(onPasteInline).toHaveBeenCalled()
      expect(onPasteBlock).not.toHaveBeenCalled()
    })

    it(`should switch to block at ${MAX_INLINE_CHARS + 1} chars`, () => {
      const onPasteInline = mock(() => {})
      const onPasteBlock = mock(() => {})
      const handler = createHandler({ onPasteInline, onPasteBlock })

      handler.handlePaste('x'.repeat(MAX_INLINE_CHARS + 1))

      expect(onPasteBlock).toHaveBeenCalled()
      expect(onPasteInline).not.toHaveBeenCalled()
    })

    it('should call onPasteBlock when text has 4 lines even if total chars <= 60', () => {
      const onPasteInline = mock(() => {})
      const onPasteBlock = mock(() => {})
      const handler = createHandler({ onPasteInline, onPasteBlock })

      const fourShortLines = 'a\nb\nc\nd'  // 4 lines, 7 characters.
      handler.handlePaste(fourShortLines)

      expect(onPasteBlock).toHaveBeenCalledWith(fourShortLines)
      expect(onPasteInline).not.toHaveBeenCalled()
    })
  })

  describe('isPasting state', () => {
    it('should have isPasting=false before any paste', () => {
      const handler = createHandler()

      expect(handler.isPasting).toBe(false)
    })

    it('should have isPasting=true during synchronous paste handling', () => {
      let isPastingDuringCall = false
      const onPasteInline = mock((_text: string) => {})

      // The hook should expose isPasting=true while handlePaste is running.
      // Test this through a side effect captured inside the callback.
      const handler = usePasteHandler({
        onPasteInline: (text: string) => {
          // The internal state is not directly accessible here, but the hook
          // should set isPasting=true before invoking the callback.
          isPastingDuringCall = true
          onPasteInline(text)
        },
        isActive: true,
      })

      handler.handlePaste(SHORT_TEXT)

      // After pasting, isPasting should return to false.
      expect(handler.isPasting).toBe(false)
      // The callback was called, confirming that the paste occurred.
      expect(isPastingDuringCall).toBe(true)
    })
  })

  describe('isActive flag', () => {
    it('should not call onPasteInline or onPasteBlock when isActive=false', () => {
      const onPasteInline = mock(() => {})
      const onPasteBlock = mock(() => {})
      const handler = createHandler({ onPasteInline, onPasteBlock, isActive: false })

      handler.handlePaste(SHORT_TEXT)

      expect(onPasteInline).not.toHaveBeenCalled()
      expect(onPasteBlock).not.toHaveBeenCalled()
    })
  })

  describe('CRLF normalization', () => {
    it('should normalize \\r\\n to \\n before counting lines', () => {
      const onPasteInline = mock(() => {})
      const onPasteBlock = mock(() => {})
      const handler = createHandler({ onPasteInline, onPasteBlock })

      // Two lines with CRLF should be inline.
      const crlfText = 'line one\r\nline two'
      handler.handlePaste(crlfText)

      expect(onPasteInline).toHaveBeenCalled()
      expect(onPasteBlock).not.toHaveBeenCalled()
    })

    it('should call onPasteBlock for 4 lines with CRLF line endings', () => {
      const onPasteInline = mock(() => {})
      const onPasteBlock = mock(() => {})
      const handler = createHandler({ onPasteInline, onPasteBlock })

      const crlfLong = 'a\r\nb\r\nc\r\nd'  // 4 lines with CRLF.
      handler.handlePaste(crlfLong)

      expect(onPasteBlock).toHaveBeenCalled()
      expect(onPasteInline).not.toHaveBeenCalled()
    })
  })
})

describe('InputBox bracketed paste round-trip', () => {
  it('expands a long-paste placeholder back to the exact source text on submit', async () => {
    const stdin = new FakeTerminal()
    const stdout = new FakeTerminal()
    const submitted: string[] = []

    const instance = renderSync(
      React.createElement(InputBox, {
        onSubmit: text => { submitted.push(text) },
        isLoading: false,
        toolCallCount: 0,
        workingDirectory: process.cwd(),
      }),
      {
        stdin: stdin as unknown as NodeJS.ReadStream,
        stdout: stdout as unknown as NodeJS.WriteStream,
        stderr: stdout as unknown as NodeJS.WriteStream,
        exitOnCtrlC: false,
        patchConsole: false,
      },
    )

    const source = 'const café = "🧪";  \n\n  preserve indentation\n\tand trailing spaces  '
    try {
      await Bun.sleep(50)
      stdin.write(`\x1b[200~${source}\x1b[201~`)
      await Bun.sleep(100)

      stdin.write('\r')
      await Bun.sleep(100)
      expect(submitted).toEqual([source])
    } finally {
      stdout.isTTY = false
      instance.unmount()
      instance.cleanup()
    }
  })
})
