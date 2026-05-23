import { useState, useEffect } from 'react'
import { getTodos, subscribe, type TodoItem, type TodoStatus } from '../../agent/todoStore.js'
import Box from '../../ink/components/Box.js'
import Text from '../../ink/components/Text.js'

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
    <Box flexDirection="column" border borderStyle="rounded" borderColor="cyan" paddingLeft={1} paddingRight={1} marginBottom={1}>
      <Text color="cyan">{'◆ TODO (' + todos.length + ')'}</Text>
      {todos.map((t) => (
        <Box key={t.id} flexDirection="row" gap={1}>
          <Text color={STATUS_COLOR[t.status]}>{STATUS_ICON[t.status]}</Text>
          <Text color={t.status === 'done' ? '#888888' : undefined}>{t.title}</Text>
        </Box>
      ))}
    </Box>
  )
}
