export interface UsePasteHandlerProps {
  onPasteBlock?: (text: string) => void
  onPasteInline?: (text: string) => void
  isActive?: boolean
}

export interface UsePasteHandlerResult {
  handlePaste: (text: string) => void
  isPasting: boolean
}

export function usePasteHandler(props: UsePasteHandlerProps): UsePasteHandlerResult {
  let pasting = false

  return {
    handlePaste: (text: string) => {
      if (props.isActive === false) return

      pasting = true
      const normalized = text.replace(/\r\n/g, '\n')
      const lineCount = normalized.length === 0 ? 1 : normalized.split('\n').length
      const isBlock = lineCount > 3 || normalized.length > 60

      if (isBlock) {
        props.onPasteBlock?.(text)
      } else {
        props.onPasteInline?.(text)
      }

      pasting = false
    },
    get isPasting() {
      return pasting
    },
  }
}
