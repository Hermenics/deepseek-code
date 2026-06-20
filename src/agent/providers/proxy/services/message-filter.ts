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

function isClientNoise(content: unknown): boolean {
  // content can be a string, array of parts, or null depending on the message
  const text = typeof content === 'string' ? content : Array.isArray(content)
    ? content.map((c: any) => (typeof c === 'string' ? c : c?.text ?? '')).join('\n')
    : ''
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
  return noisePatterns.some((p) => text.includes(p))
}
