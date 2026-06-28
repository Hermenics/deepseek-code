export interface RelayConfig {
  port: number
  host: string
  redis: {
    url: string
    streamMaxLen: number
    streamTTL: number
  }
  session: {
    maxIdleMs: number
    heartbeatIntervalMs: number
    maxDevicesPerCli: number
  }
  rateLimit: {
    messagesPerSecond: number
    bytesPerSecond: number
  }
}

export function loadConfig(): RelayConfig {
  return {
    port: Number(process.env.PORT ?? 8787),
    host: process.env.HOST ?? '0.0.0.0',
    redis: {
      url: process.env.REDIS_URL ?? 'redis://localhost:6379',
      streamMaxLen: 500,
      streamTTL: 600,
    },
    session: {
      maxIdleMs: 600_000,
      heartbeatIntervalMs: 30_000,
      maxDevicesPerCli: 5,
    },
    rateLimit: {
      messagesPerSecond: 50,
      bytesPerSecond: 1_048_576,
    },
  }
}

export const config = loadConfig()
