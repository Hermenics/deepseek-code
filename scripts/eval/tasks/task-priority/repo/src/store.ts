import type { Task } from './types'

export class TaskStore {
  private tasks: Task[] = []

  add(title: string): Task {
    const task: Task = { id: this.tasks.length + 1, title, done: false }
    this.tasks.push(task)
    return task
  }

  complete(id: number): void {
    const task = this.tasks.find((t) => t.id === id)
    if (!task) throw new Error(`Task ${id} not found`)
    task.done = true
  }

  list(): Task[] {
    return [...this.tasks]
  }
}
