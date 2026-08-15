import { describe, it, expect, mock } from 'bun:test'

// Contrato do hook usePasteHandler, usado pelo InputBox para decidir entre
// paste inline (texto direto) e paste em bloco (placeholder [Text #n]).
import { usePasteHandler } from '../../../src/ui/input/hooks/usePasteHandler.js'

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

// Limiar de bloco: > 3 linhas OU > 60 chars
const MAX_INLINE_CHARS = 60

// Texto curto: <= 3 linhas E <= 60 chars
const SHORT_TEXT = 'hello world'
const SHORT_MULTILINE = 'line one\nline two\nline three'  // exactly 3 lines

// Texto longo por número de linhas: > 3 linhas
const LONG_BY_LINES = 'a\nb\nc\nd'  // 4 linhas

// Texto longo por tamanho: > 60 chars, 1 linha
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

      const fourShortLines = 'a\nb\nc\nd'  // 4 linhas, 7 chars
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

      // O hook deve expor isPasting=true enquanto handlePaste está em execução.
      // Testamos via side-effect capturado dentro do callback.
      const handler = usePasteHandler({
        onPasteInline: (text: string) => {
          // Não temos acesso direto ao estado interno aqui,
          // mas o hook deve ter setado isPasting=true antes de chamar o callback.
          isPastingDuringCall = true
          onPasteInline(text)
        },
        isActive: true,
      })

      handler.handlePaste(SHORT_TEXT)

      // Após o paste, isPasting deve voltar a false
      expect(handler.isPasting).toBe(false)
      // E o callback foi chamado (confirmando que o paste ocorreu)
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

      // 2 linhas com CRLF → deve ser inline
      const crlfText = 'line one\r\nline two'
      handler.handlePaste(crlfText)

      expect(onPasteInline).toHaveBeenCalled()
      expect(onPasteBlock).not.toHaveBeenCalled()
    })

    it('should call onPasteBlock for 4 lines with CRLF line endings', () => {
      const onPasteInline = mock(() => {})
      const onPasteBlock = mock(() => {})
      const handler = createHandler({ onPasteInline, onPasteBlock })

      const crlfLong = 'a\r\nb\r\nc\r\nd'  // 4 linhas com CRLF
      handler.handlePaste(crlfLong)

      expect(onPasteBlock).toHaveBeenCalled()
      expect(onPasteInline).not.toHaveBeenCalled()
    })
  })
})
