export interface UseInputHistoryResult {
  historyUp: (currentDraft: string) => string | undefined
  historyDown: () => string | undefined
  resetHistory: () => void
  isNavigating: boolean
}

/** Shell-style prompt history navigation. The first `up()` saves the in-progress draft; stepping `down()` past the newest entry restores it and ends navigation. */
export class InputHistory {
  private _entries: string[] = []
  private index: number | null = null
  private draft: string | null = null

  get entries(): string[] {
    return [...this._entries]
  }

  constructor() {}

  setHistory(entries: string[]): void {
    this._entries = [...entries]
    this.reset()
  }

  /** Moves to the next older entry, saving `currentDraft` on the first step; undefined when history is empty or already at the oldest entry. */
  up(currentDraft: string): string | undefined {
    if (this._entries.length === 0) return undefined

    if (this.index === null) {
      this.index = this._entries.length - 1
      this.draft = currentDraft
      return this._entries[this.index]
    }

    if (this.index === 0) return undefined

    this.index -= 1
    return this._entries[this.index]
  }

  /** Moves to the next newer entry; past the newest it ends navigation and returns the saved draft (or ''). Undefined when not navigating. */
  down(): string | undefined {
    if (this.index === null) return undefined

    if (this.index < this._entries.length - 1) {
      this.index += 1
      return this._entries[this.index]
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

/** Wraps a fresh InputHistory seeded with `entries`. Not a real React hook: nothing is memoized, so navigation state is lost between calls (InputBox keeps an InputHistory in a ref instead). */
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
