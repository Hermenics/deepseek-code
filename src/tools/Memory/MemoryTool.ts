import { Tool } from '../types.js'
import { reviewMemory, addEntry, replaceEntry, removeEntry, confirmEntry } from '../../agent/memory.js'
import type { MemoryTarget, MemoryWriteOptions } from '../../agent/memory.js'
import { formatToolError } from '../result.js'

type MemoryMutationAction = 'add' | 'replace' | 'remove' | 'confirm'

function normalizeMemoryMutationResult(action: MemoryMutationAction, target: MemoryTarget, result: string): string {
  if (result === `Added to ${target} memory.` || result === `Replaced entry in ${target} memory.`
    || result === `Removed entry from ${target} memory.` || result === `Confirmed entry in ${target} memory.`) return result

  if (result === 'Memory is disabled in settings.') return formatToolError('tool', 'MEMORY_DISABLED', result)
  if (result === 'Memory entry is empty.' || result === 'Memory match must be non-empty.') {
    return formatToolError('validation', 'INVALID_ARGUMENTS', result)
  }
  if (result === 'Memory entries cannot contain instructions or policy overrides.') {
    return formatToolError('validation', 'MEMORY_UNSAFE_CONTENT', result)
  }
  if (result.startsWith('Memory full')) return formatToolError('tool', 'MEMORY_LIMIT_EXCEEDED', result)
  if (result.startsWith('No entry matching ')) return formatToolError('conflict', 'MEMORY_MATCH_NOT_FOUND', result)
  if (result.startsWith('Memory match is ambiguous')) return formatToolError('conflict', 'MEMORY_MATCH_AMBIGUOUS', result)
  if (result === `Already in ${target} memory.` || /^A .+ entry already matches;/.test(result)) {
    return formatToolError('conflict', 'MEMORY_DUPLICATE', result)
  }
  if (result === 'User confirmation is required; nothing was changed.') {
    return formatToolError('permission', 'MEMORY_CONFIRMATION_REQUIRED', result)
  }

  return formatToolError('tool', `MEMORY_${action.toUpperCase()}_FAILED`, result || 'Memory operation failed.')
}

/** Tool that lists, adds, replaces or removes entries in the persistent agent or user memory. It prefers the session's memory store and falls back to the global memory module. */
export const MemoryTool: Tool = {
  name: 'memory',
  description:
    'Manage persistent memory across sessions. Use this to remember important facts about the project, ' +
    'user preferences, or things learned. Memory persists between sessions and is injected into context at startup.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['add', 'replace', 'remove', 'list', 'review', 'confirm'],
        description: 'Action to perform: add, replace, remove, list with freshness metadata, review expired/stale/unverified entries, or ask the user to confirm an unverified project fact',
      },
      target: {
        type: 'string',
        enum: ['agent', 'user'],
        description: 'Which memory store: agent (facts, conventions) or user (preferences, style)',
      },
      content: {
        type: 'string',
        description: 'For add: the new entry text. For replace: the reviewed replacement text. For remove: not needed.',
      },
      match: {
        type: 'string',
        description: 'For replace/remove/confirm: unique substring to find an active, expired, stale, or unverified entry',
      },
      source_path: {
        type: 'string',
        description: 'Optional existing, non-sensitive file inside the project. Its relative path and SHA-256 are captured as provenance and the fact is withheld if that file changes.',
      },
      expires_at: {
        type: 'string',
        description: 'Optional expiration as an ISO date or timestamp. Project agent facts default to a 90-day review deadline.',
      },
    },
    required: ['action', 'target'],
  },
  async execute(args, context) {
    const action = args.action as string
    const target = args.target as MemoryTarget
    const content = (args.content as string | undefined)?.trim()
    const match = (args.match as string | undefined)?.trim()
    const options: MemoryWriteOptions = {
      ...(typeof args.source_path === 'string' && args.source_path.trim() ? { sourcePath: args.source_path.trim() } : {}),
      ...(typeof args.expires_at === 'string' && args.expires_at.trim() ? { expiresAt: args.expires_at.trim() } : {}),
    }
    if (target !== 'agent' && target !== 'user') return formatToolError('validation', 'INVALID_ARGUMENTS', 'target must be agent or user.')

    if ((action === 'add' || action === 'replace') && !content) {
      return formatToolError('validation', 'INVALID_ARGUMENTS', 'content is required for add/replace actions.')
    }
    if ((action === 'replace' || action === 'remove' || action === 'confirm') && !match) {
      return formatToolError('validation', 'INVALID_ARGUMENTS', 'match is required for replace/remove/confirm actions.')
    }

    const store = context?.session?.memory
    if ((action === 'add' || action === 'replace') && target === 'user') {
      if (!context?.askUser) return formatToolError('permission', 'MEMORY_CONFIRMATION_REQUIRED', 'Saving user memory requires interactive confirmation; nothing was changed.')
      const answers = await context.askUser([{
        header: 'Save memory',
        question: `Save this user preference to persistent memory for future sessions?\n\n${content}`,
        type: 'yesno',
      }], context.signal)
      if (!answers || !Object.values(answers).some(answer => /^yes$/i.test(answer.trim()))) {
        return formatToolError('permission', 'MEMORY_CONSENT_DENIED', 'The user did not approve saving this memory; nothing was changed.')
      }
      options.provenance = 'explicit-user'
    }
    switch (action) {
      case 'list':
      case 'review': {
        const entries = store ? await store.review(target) : await reviewMemory(target)
        const shown = action === 'review' ? entries.filter(entry => entry.status !== 'active') : entries
        if (shown.length === 0) return action === 'review' ? `No stale or unverified entries in ${target} memory.` : `No entries in ${target} memory.`
        return shown.map((entry, index) => {
          const scope = entry.scope.kind === 'project' ? `project ${entry.scope.directory}` : 'user'
          const freshness = entry.expiresAt ? `; review by ${entry.expiresAt}` : ''
          const source = entry.sourcePath ? `; source ./${entry.sourcePath} sha256:${entry.sourceHash}` : '; source unknown'
          const established = entry.createdAt ?? `unknown (imported ${entry.importedAt ?? 'date unknown'})`
          return `${index + 1}. [${entry.status}; ${scope}; captured ${established}${freshness}; origin ${entry.origin}${source}] ${entry.content}`
        }).join('\n')
      }
      case 'add': {
        const result = store ? await store.add(target, content!, options) : await addEntry(target, content!, options)
        return normalizeMemoryMutationResult(action, target, result)
      }
      case 'replace': {
        const result = store ? await store.replace(target, match!, content!, options) : await replaceEntry(target, match!, content!, options)
        return normalizeMemoryMutationResult(action, target, result)
      }
      case 'remove': {
        const result = store ? await store.remove(target, match!) : await removeEntry(target, match!)
        return normalizeMemoryMutationResult(action, target, result)
      }
      case 'confirm': {
        if (!context?.askUser) return formatToolError('permission', 'MEMORY_CONFIRMATION_REQUIRED', 'Confirmation requires an interactive user handler; no memory was changed.')
        const entries = store ? await store.review(target) : await reviewMemory(target)
        const matching = entries.filter(entry => entry.content.includes(match!))
        if (matching.length > 1) return formatToolError('conflict', 'MEMORY_MATCH_AMBIGUOUS', 'Memory match is ambiguous; use a unique substring. Nothing was changed.')
        if (matching.length === 0) return formatToolError('conflict', 'MEMORY_MATCH_NOT_FOUND', `No entry matching "${match}" found.`)
        const entry = matching[0]!
        const answers = await context.askUser([{
          header: 'Confirm memory',
          question: `Confirm this ${target === 'user' ? 'user preference' : 'project memory fact'} for future context?\n\n${entry.content}`,
          type: 'yesno',
        }], context.signal)
        if (!answers || !Object.values(answers).some(answer => /^yes$/i.test(answer.trim()))) {
          return formatToolError('permission', 'MEMORY_CONSENT_DENIED', 'The user did not confirm this memory entry; nothing was changed.')
        }
        const result = store ? await store.confirm(target, match!, true) : await confirmEntry(target, match!, true)
        return normalizeMemoryMutationResult(action, target, result)
      }
      default:
        return formatToolError('validation', 'INVALID_ARGUMENTS', `Unknown action: ${action}`)
    }
  },
}
