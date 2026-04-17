import React, { useState, useEffect } from 'react'
import { Box, Text } from 'ink'
import { getTodos, subscribe, type TodoItem, type TodoStatus } from '../../agent/todoStore.js'

const STATUS_ICON: Record<TodoStatus, string> = {
  pending: '○',
  in_progress: '◐',
  done: '●',
}

const STATUS_COLOR: Record<TodoStatus, string> = {
  pending: 'gray',
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
    <Box flexDirection="column" borderStyle="single" borderColor="cyan" paddingX={1} marginBottom={1}>
      <Text color="cyan" bold>◆ TODO</Text>
      {todos.map((t) => (
        <Box key={t.id} gap={1}>
          <Text color={STATUS_COLOR[t.status] as any}>{STATUS_ICON[t.status]}</Text>
          <Text color={t.status === 'done' ? 'gray' : undefined}>{t.title}</Text>
        </Box>
      ))}
    </Box>
  )
}
