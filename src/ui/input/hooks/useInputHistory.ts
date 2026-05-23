export interface UseInputHistoryResult {
  historyUp: (currentDraft: string) => string | undefined
  historyDown: () => string | undefined
  resetHistory: () => void
  isNavigating: boolean
}

export class InputHistory {
  private entries: string[] = []
  private index: number | null = null
  private draft: string | null = null

  constructor() {}

  setHistory(entries: string[]): void {
    this.entries = [...entries]
    this.reset()
  }

  up(currentDraft: string): string | undefined {
    if (this.entries.length === 0) return undefined

    if (this.index === null) {
      this.index = this.entries.length - 1
      this.draft = currentDraft
      return this.entries[this.index]
    }

    if (this.index === 0) return undefined

    this.index -= 1
    return this.entries[this.index]
  }

  down(): string | undefined {
    if (this.index === null) return undefined

    if (this.index < this.entries.length - 1) {
      this.index += 1
      return this.entries[this.index]
    }

    const restored = this.draft ?? ''
    this.reset()
    return restored
  }

  reset(): void {
    this.index = null
    this.draft = null
  }

  get isNavigating(): boolean {
    return this.index !== null
  }
}

export function useInputHistory(props: { entries: string[] }): UseInputHistoryResult {
  const history = new InputHistory()
  history.setHistory(props.entries)

  return {
    historyUp: (currentDraft: string) => history.up(currentDraft),
    historyDown: () => history.down(),
    resetHistory: () => history.reset(),
    get isNavigating() {
      return history.isNavigating
    },
  }
}
