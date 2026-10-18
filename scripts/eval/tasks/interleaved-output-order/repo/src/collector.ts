import type { SimulatedOutput, StreamRecord } from './simulator.js'

export interface CollectedEvent extends StreamRecord {
  channel: 'stdout' | 'stderr'
}

export function collectOutput(output: SimulatedOutput): CollectedEvent[] {
  return [
    ...output.stdout.map((event) => ({ ...event, channel: 'stdout' as const })),
    ...output.stderr.map((event) => ({ ...event, channel: 'stderr' as const })),
  ]
}

export function diagnoseBuild(output: SimulatedOutput): { events: CollectedEvent[]; firstFailure: CollectedEvent | null } {
  const events = collectOutput(output)
  return { events, firstFailure: events.find((event) => /\b(error|fatal)\b/i.test(event.text)) ?? null }
}
