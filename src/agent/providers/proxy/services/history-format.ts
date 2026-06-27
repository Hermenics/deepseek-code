type Message = { role: string; content: string }

export function formatFullHistory(messages: Message[]): string {
  return messages
    .map((m) => {
      if (m.role === 'system') return `[System] ${m.content}`
      if (m.role === 'assistant') return `[Assistant] ${m.content}`
      if (m.role === 'tool') return `[Tool Result] ${m.content}`
      return m.content
    })
    .join('\n\n')
}

export function buildToolResultContext(messages: Message[]): string {
  const lastUserIdx =
    messages
      .map((m, i) => ({ m, i }))
      .filter(({ m }) => m.role === 'user')
      .pop()?.i ?? 0

  const toolContext = messages.slice(lastUserIdx + 1)

  return (
    toolContext
      .map((m) => {
        if (m.role === 'assistant') return `[You called a tool]`
        if (m.role === 'tool') return `[Tool Result]\n${m.content}`
        return m.content
      })
      .join('\n\n') +
    '\n\n[The tool has been executed. Now analyze the result above and continue. If you need another tool, call it. If you have enough information, respond to the user with text.]'
  )
}
