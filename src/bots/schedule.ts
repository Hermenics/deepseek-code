import type { Schedule } from './types.js'

/** Schedules are explicit data; model prose never changes when a job runs. */
export function validateSchedule(value: unknown): Schedule {
  if (!value || typeof value !== 'object') throw new Error('Schedule must be an object')
  const s = value as Record<string, unknown>
  const integer = (n: unknown, min: number, max: number) => typeof n === 'number' && Number.isSafeInteger(n) && n >= min && n <= max
  const endsAt = () => {
    if (s.endsAt === undefined) return undefined
    if (!integer(s.endsAt, 1, 8.64e15)) throw new Error('endsAt must be a positive epoch-millisecond timestamp')
    return s.endsAt as number
  }
  if (s.kind === 'once' && Object.hasOwn(s, 'endsAt')) throw new Error('endsAt is only supported for recurring schedules')
  if (s.kind === 'once' && integer(s.at, 0, 8.64e15)) return { kind: 'once', at: s.at as number }
  if (s.kind === 'interval' && integer(s.everyMs, 60_000, 365 * 86400_000)) return { kind: 'interval', everyMs: s.everyMs as number, ...(endsAt() === undefined ? {} : { endsAt: endsAt() }) }
  if (s.kind === 'event' && typeof s.topic === 'string' && /^[a-zA-Z0-9._:-]{1,128}$/.test(s.topic)) return { kind: 'event', topic: s.topic, ...(endsAt() === undefined ? {} : { endsAt: endsAt() }) }
  if (s.kind === 'daily' && integer(s.hour, 0, 23) && integer(s.minute, 0, 59) && typeof s.timeZone === 'string') {
    new Intl.DateTimeFormat('en-US', { timeZone: s.timeZone }).format()
    if (s.weekdays !== undefined && (!Array.isArray(s.weekdays) || s.weekdays.length === 0 || s.weekdays.some(d => !integer(d, 0, 6)))) throw new Error('weekdays must contain days 0 (Sunday) through 6')
    return { kind: 'daily', hour: s.hour as number, minute: s.minute as number, timeZone: s.timeZone, ...(s.weekdays ? { weekdays: [...new Set(s.weekdays as number[])] } : {}), ...(endsAt() === undefined ? {} : { endsAt: endsAt() }) }
  }
  throw new Error('Invalid schedule')
}

/** Missed occurrences coalesce into one current run; daily wall times occur once across DST folds. */
export function nextOccurrence(schedule: Schedule, after: number): number | null {
  if (schedule.kind === 'event') return null
  if (schedule.kind === 'once') return schedule.at > after ? schedule.at : null
  if (schedule.kind === 'interval') {
    const next = after + schedule.everyMs
    return schedule.endsAt !== undefined && next > schedule.endsAt ? null : next
  }
  const format = new Intl.DateTimeFormat('en-US', { timeZone: schedule.timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' })
  const parts = (time: number) => Object.fromEntries(format.formatToParts(time).map(p => [p.type, p.value]))
  const start = parts(after)
  const startDate = `${start.year}-${start.month}-${start.day}`
  const alreadyPast = Number(start.hour) * 60 + Number(start.minute) >= schedule.hour * 60 + schedule.minute
  // ponytail: at most eight days of minute steps, supports DST gaps/folds; use Temporal when the runtime ships it.
  for (let time = Math.floor(after / 60_000) * 60_000 + 60_000; time <= after + 8 * 86400_000; time += 60_000) {
    const p = parts(time)
    if (alreadyPast && `${p.year}-${p.month}-${p.day}` === startDate) continue
    if (Number(p.hour) === schedule.hour && Number(p.minute) === schedule.minute && (!schedule.weekdays || schedule.weekdays.includes(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday!)))) return schedule.endsAt !== undefined && time > schedule.endsAt ? null : time
  }
  throw new Error('Unable to find next daily occurrence')
}
