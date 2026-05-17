import type { ChatMessage } from '../types/index.js'

export function filterMessages(messages: ChatMessage[]): ChatMessage[] {
  const filtered: ChatMessage[] = []

  for (const msg of messages) {
    if (msg.role === 'system') {
      if (isClientNoise(msg.content)) continue
      filtered.push(msg)
    } else {
      filtered.push(msg)
    }
  }

  return filtered
}

function isClientNoise(content: string): boolean {
  const noisePatterns = [
    'system-reminder',
    'The following skills are available',
    'Contents of /home/',
    'Contents of /Users/',
    'CLAUDE.md',
    'command-name',
    'command-message',
    'command-args',
    'local-command-stdout',
    'local-command-caveat',
    'currentDate',
    'Today\'s date is',
    'Codebase and user instructions',
    'IMPORTANT: These instructions OVERRIDE',
    'As you answer the user\'s questions, you can use the following context',
  ]
  return noisePatterns.some((p) => content.includes(p))
}
