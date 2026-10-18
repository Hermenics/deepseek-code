export interface LatencySummary {
  count: number
  p50: number
  p95: number
}

export function summarizeLatency(samples: number[]): LatencySummary {
  const sorted = [...samples].sort((left, right) => left - right)
  return {
    count: samples.length,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
  }
}

function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0
  return sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))]!
}
