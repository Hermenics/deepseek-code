/**
 * Pure queue logic for queued messages feature.
 * All functions are immutable — they never mutate the input array.
 */
import { parseCommand } from '../commands.js'

export const MAX_QUEUE_SIZE = 10

/** Appends a message to the queue, silently returning the original queue unchanged once it holds MAX_QUEUE_SIZE items. */
export function enqueue<T>(queue: T[], msg: T): T[] {
  if (queue.length >= MAX_QUEUE_SIZE) return queue
  return [...queue, msg]
}

/** Splits the queue into its first message (null when empty) and the remaining items. */
export function dequeue<T>(queue: T[]): { next: T | null; remaining: T[] } {
  if (queue.length === 0) return { next: null, remaining: [] }
  const [first, ...rest] = queue
  return { next: first!, remaining: rest }
}

/** Selects an interrupt replacement before ordinary queued messages without removing or reordering them. */
export function dequeueWithPriority<T>(queue: T[], priority: T | null): { next: T | null; remaining: T[] } {
  if (priority !== null) return { next: priority, remaining: queue }
  return dequeue(queue)
}

/** Runs persistence tasks in call order, continuing the queue after an individual failure. */
export function serializeAsync<T>(tail: { current: Promise<void> }, task: () => Promise<T>): Promise<T> {
  const result = tail.current.then(task, task)
  tail.current = result.then(() => undefined, () => undefined)
  return result
}

/** Rejects autosave snapshots that would advance the objective beyond its durable checkpoint. */
export function isObjectiveRevisionDurable(snapshotRevision: number | undefined, durableRevision: number | undefined): boolean {
  return snapshotRevision === undefined || snapshotRevision === (durableRevision ?? 0)
}

/** Runs setup and dispatch only while the objective revision captured by the queued prompt remains current. */
export async function runWithObjectiveRevisionGuard<T>(
  expectedRevision: number | undefined,
  getCurrentRevision: () => number,
  prepare: (isCurrent: () => boolean) => Promise<T>,
  execute: (prepared: T, isCurrent: () => boolean) => Promise<boolean | void>,
  onStale: () => void,
): Promise<boolean> {
  const isCurrent = () => expectedRevision === undefined || getCurrentRevision() === expectedRevision
  if (!isCurrent()) {
    onStale()
    return false
  }
  const prepared = await prepare(isCurrent)
  if (!isCurrent()) {
    onStale()
    return false
  }
  const executed = await execute(prepared, isCurrent)
  if (executed === false && !isCurrent()) {
    onStale()
    return false
  }
  return true
}

/** Removes synthetic continuation prompts so they cannot revive a superseded goal objective. */
export function dropGoalContinuations<T extends { text: string }>(queue: T[]): T[] {
  return queue.filter((message) => !/^\[Goal continuation \d+\/\d+\]/.test(message.text))
}

/**
 * Returns a /btw question for immediate execution, or undefined for queued input.
 * Parsing is shared with the command dispatcher so aliases cannot drift here.
 */
export function getImmediateBtwQuestion(input: string): string | undefined {
  const result = parseCommand(input)
  return result?.type === 'btw' ? result.question : undefined
}

/** Parses only the explicit `/revise <objective>` command; null means ordinary input. */
export function getObjectiveRevision(input: string): string | null {
  const match = /^\/revise(?:\s+([\s\S]*))?$/i.exec(input.trim())
  return match ? (match[1] ?? '').trim() : null
}

/** Parses only the explicit `/steer <instruction>` command; null means ordinary input. */
export function getSteerInstruction(input: string): string | null {
  const match = /^\/steer(?:\s+([\s\S]*))?$/i.exec(input.trim())
  return match ? (match[1] ?? '').trim() : null
}
