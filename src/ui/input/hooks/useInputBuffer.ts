export interface BufferEntry {
  text: string
  cursorOffset: number
  timestamp: number
}

export interface UseInputBufferResult {
  pushToBuffer: (text: string, cursorOffset: number) => void
  undo: () => BufferEntry | undefined
  redo: () => BufferEntry | undefined
  canUndo: boolean
  canRedo: boolean
  clearBuffer: () => void
}

/** Linear undo/redo stack of input snapshots, capped at `maxSize` (default 50). Pushing after an undo discards the redo branch. */
export class InputBuffer {
  private readonly maxSize: number
  private entries: BufferEntry[] = []
  private currentIndex = -1

  constructor(options?: { maxSize?: number }) {
    this.maxSize = options?.maxSize ?? 50
  }

  /** Records a snapshot, dropping any redo entries and the oldest entries beyond maxSize. */
  push(text: string, cursorOffset: number): void {
    const entry: BufferEntry = { text, cursorOffset, timestamp: Date.now() }

    if (this.currentIndex < this.entries.length - 1) {
      this.entries = this.entries.slice(0, this.currentIndex + 1)
    }

    this.entries.push(entry)

    if (this.entries.length > this.maxSize) {
      const overflow = this.entries.length - this.maxSize
      this.entries.splice(0, overflow)
    }

    this.currentIndex = this.entries.length - 1
  }

  /** Steps back one snapshot and returns it; never moves before the first snapshot. */
  undo(): BufferEntry | undefined {
    if (!this.canUndo) return undefined
    this.currentIndex -= 1
    return this.entries[this.currentIndex]
  }

  /** Steps forward one snapshot after an undo and returns it. */
  redo(): BufferEntry | undefined {
    if (!this.canRedo) return undefined
    this.currentIndex += 1
    return this.entries[this.currentIndex]
  }

  get canUndo(): boolean {
    return this.currentIndex > 0
  }

  get canRedo(): boolean {
    return this.currentIndex >= 0 && this.currentIndex < this.entries.length - 1
  }

  clear(): void {
    this.entries = []
    this.currentIndex = -1
  }
}

/** Wraps a fresh InputBuffer. Not a real React hook: nothing is memoized, so history is lost between calls, and `debounceMs` is currently ignored. */
export function useInputBuffer(props?: { maxSize?: number; debounceMs?: number }): UseInputBufferResult {
  const buffer = new InputBuffer({ maxSize: props?.maxSize })

  return {
    pushToBuffer: (text: string, cursorOffset: number) => {
      buffer.push(text, cursorOffset)
    },
    undo: () => buffer.undo(),
    redo: () => buffer.redo(),
    get canUndo() {
      return buffer.canUndo
    },
    get canRedo() {
      return buffer.canRedo
    },
    clearBuffer: () => {
      buffer.clear()
    },
  }
}
