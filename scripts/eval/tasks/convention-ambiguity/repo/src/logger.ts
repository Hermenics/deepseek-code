export interface Logger {
  info(event: string, fields?: Record<string, unknown>): void
  warn(event: string, fields?: Record<string, unknown>): void
}

export const silentLogger: Logger = { info() {}, warn() {} }
