import { fmt } from './money'

/** Public export settings consumed by the PDF service; the `fmt` key is part of its API. */
export const exportOptions = { fmt: 'pdf' as const }

export function invoiceLine(description: string, cents: number, format: 'pdf' | 'txt' = 'txt'): string {
  return `[${format.toUpperCase()}] ${description}: ${fmt(cents)}`
}
