import type { Task } from './types'

export function formatTask(task: Task): string {
  return `[${task.done ? 'x' : ' '}] ${task.title}`
}
