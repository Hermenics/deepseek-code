export const ERROR_MARKER = 'ERROR[UTF-8-41]: checksum mismatch after decoding 🧪'

export function makeBuildLog(): string {
  const traces = Array.from({ length: 240 }, (_, index) =>
    `trace ${index.toString().padStart(3, '0')} 👨‍👩‍👧‍👦 cafe\u0301 測定 / phase-${index}`,
  )
  const boundary = `${'x'.repeat(4095)}👩‍💻 boundary probe`
  return [boundary, ...traces, ERROR_MARKER, 'build aborted'].join('\n')
}
