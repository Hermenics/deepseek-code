export const TRUNCATION_MARKER = '\n…[truncated]…\n'

export function truncateOutput(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text
  return text.slice(0, maxBytes) + TRUNCATION_MARKER
}
