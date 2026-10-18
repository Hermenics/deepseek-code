export function selectEvalTasks(requested: string | undefined, available: readonly string[], manifestTasks: readonly string[]): string[] {
  const tasks = requested === undefined ? [...manifestTasks] : requested.split(',').map(task => task.trim())
  if (requested === undefined && new Set(tasks).size !== tasks.length) throw new Error('Benchmark manifest contains duplicate task names')
  const unknown = tasks.filter(task => !available.includes(task))
  if (unknown.length > 0) throw new Error(`Unknown task(s): ${unknown.join(', ')}. Available: ${[...available].sort().join(', ')}`)
  return tasks
}
