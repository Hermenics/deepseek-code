const ALLOWED_MODELS = ['deepseek-v4-flash', 'deepseek-v4-pro', 'deepseek-thinking', 'deepseek-reasoner']

export function validateRequest(body: any): string | null {
  if (!body.model) return 'Missing required field: model'
  if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
    return 'Missing required field: messages'
  }
  if (!ALLOWED_MODELS.includes(body.model)) {
    return `Unknown model: ${body.model}. Allowed: ${ALLOWED_MODELS.join(', ')}`
  }
  return null
}
