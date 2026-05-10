import { useState, useEffect } from 'react'
import { getTodos, subscribe, type TodoItem, type TodoStatus } from '../../agent/todoStore.js'

const STATUS_ICON: Record<TodoStatus, string> = {
  pending: '○',
  in_progress: '◉',
  done: '●',
}

const STATUS_COLOR: Record<TodoStatus, string> = {
  pending: '#888888',
  in_progress: 'yellow',
  done: 'green',
}

export function TodoPanel() {
  const [todos, setTodos] = useState<TodoItem[]>(getTodos)

  useEffect(() => {
    return subscribe(() => setTodos(getTodos()))
  }, [])

  if (!todos.length) return null

  return (
    <box flexDirection="column" border borderStyle="rounded" borderColor="cyan" paddingLeft={1} paddingRight={1} marginBottom={1}>
      <text fg="cyan">{'◆ TODO (' + todos.length + ')'}</text>
      {todos.map((t) => (
        <box key={t.id} flexDirection="row" gap={1}>
          <text fg={STATUS_COLOR[t.status]}>{STATUS_ICON[t.status]}</text>
          <text fg={t.status === 'done' ? '#888888' : undefined}>{t.title}</text>
        </box>
      ))}
    </box>
  )
}
