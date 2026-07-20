/**
 * Post-compaction cleanup — runs after a successful full compaction.
 * Re-injects fresh system state and prunes stale caches.
 */

export interface PostCompactCleanupOptions {
  onSystemPromptRefresh?: () => string | undefined
  onClearFileCache?: () => void
  onLog?: (message: string) => void
}

export interface PostCompactResult {
  systemPromptRefreshed: boolean
  fileCacheCleared: boolean
  refreshedPrompt?: string
}

/**
 * Runs cleanup tasks after compaction completes successfully.
 * Called by the compaction orchestrator after boundaries are inserted.
 */
export function runPostCompactCleanup(options: PostCompactCleanupOptions = {}): PostCompactResult {
  const { onSystemPromptRefresh, onClearFileCache, onLog } = options
  const result: PostCompactResult = { systemPromptRefreshed: false, fileCacheCleared: false }

  if (onClearFileCache) {
    onClearFileCache()
    result.fileCacheCleared = true
    onLog?.('Post-compact: file cache cleared')
  }

  if (onSystemPromptRefresh) {
    const refreshed = onSystemPromptRefresh()
    if (refreshed) {
      result.systemPromptRefreshed = true
      result.refreshedPrompt = refreshed
      onLog?.('Post-compact: system prompt refreshed')
    }
  }

  return result
}
