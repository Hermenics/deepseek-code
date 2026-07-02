const MODEL_MAP: Record<string, string> = {
  'deepseek-v4-flash': 'Flash',
  'deepseek-v4-pro': 'Pro',
  // Deprecated aliases (will be removed after 2026/07/24)
  'deepseek-chat': 'Flash',
  'deepseek-reasoner': 'Flash',
}

export function resolveModel(modelId: string): string {
  const uiName = MODEL_MAP[modelId]
  if (!uiName) throw new Error(`Unknown model: ${modelId}`)
  return uiName
}

export function getAvailableModels() {
  return Object.keys(MODEL_MAP).map((id) => ({
    id,
    object: 'model' as const,
    created: 1700000000,
    owned_by: 'deepseek',
  }))
}

export function isThinkingModel(modelId: string): boolean {
  return modelId.includes('pro')
}
