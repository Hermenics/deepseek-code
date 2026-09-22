import { useState, useEffect } from 'react'
import { getTodos, subscribe, type TodoItem, type TodoStatus } from '../../agent/todoStore.js'
import Box from '../../ink/components/Box.js'
import Text from '../../ink/components/Text.js'
import { useThemeColors } from '../design-system/ThemeProvider.js'

const STATUS_ICON: Record<TodoStatus, string> = {
  pending: '○',
  in_progress: '◉',
  done: '●',
}

/** Bordered panel listing the agent's todo items with status icons, re-rendering on todo-store changes; renders nothing when the list is empty. */
export function TodoPanel() {
  const colors = useThemeColors()
  const [todos, setTodos] = useState<TodoItem[]>(getTodos)

  useEffect(() => {
    return subscribe(() => setTodos(getTodos()))
  }, [])

  if (!todos.length) return null

  return (
    <Box flexDirection="column" border borderStyle="rounded" borderColor={colors.h2} paddingLeft={1} paddingRight={1} marginBottom={1}>
      <Text color={colors.h2}>{'◆ TODO (' + todos.length + ')'}</Text>
      {todos.map((t) => (
        <Box key={t.id} flexDirection="row" gap={1}>
          <Text color={t.status === 'pending' ? colors.textDim : t.status === 'in_progress' ? colors.warning : colors.success}>{STATUS_ICON[t.status]}</Text>
          <Text color={t.status === 'done' ? colors.textDim : undefined}>{t.title}</Text>
        </Box>
      ))}
    </Box>
  )
}
