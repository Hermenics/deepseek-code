export interface BufferEntry {
  text: string
  cursorOffset: number
  timestamp: number
}

export class InputBuffer {
  private readonly maxSize: number
  private entries: BufferEntry[] = []
  private currentIndex = -1

  constructor(options?: { maxSize?: number }) {
    this.maxSize = options?.maxSize ?? 50
  }

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

  undo(): BufferEntry | undefined {
    if (!this.canUndo) return undefined
    this.currentIndex -= 1
    return this.entries[this.currentIndex]
  }

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
