import React from 'react'
import type { Message } from '../App.js'
import { getThemeColors, STATUS_ICONS } from '../theme.js'
import type { ThemeName } from '../theme.js'
import Box from '../../ink/components/Box.js'
import Text from '../../ink/components/Text.js'

/** Read-only tools that fold into one summary line, as Claude Code's collapseReadSearch does; anything else breaks the group. */
const COLLAPSIBLE: Record<string, 'read' | 'search' | 'list'> = {
  read_file: 'read',
  grep: 'search',
  glob: 'search',
  read_folder: 'list',
}

export interface ToolGroup {
  readPaths: Set<string>
  searches: number
  lists: number
}

type Item = { kind: 'message'; message: Message; index: number } | { kind: 'truncated'; index: number }
export type GroupedItem = Item | { kind: 'group'; group: ToolGroup; index: number }

function collapsible(message: Message): { kind: 'read' | 'search' | 'list'; detail: string } | null {
  if (message.role !== 'tool' || !message.content.startsWith('✓ ')) return null
  const raw = message.content.slice(2)
  const sep = raw.indexOf(' → ')
  const kind = COLLAPSIBLE[sep >= 0 ? raw.slice(0, sep) : raw]
  return kind ? { kind, detail: sep >= 0 ? raw.slice(sep + 3) : '' } : null
}

/** Folds each run of consecutive read/search/list tools into one group; thinking inside a run is moved after the group instead of splitting it. */
export function collapseToolGroups(items: Item[]): GroupedItem[] {
  const result: GroupedItem[] = []
  let group: { group: ToolGroup; index: number } | null = null
  let deferred: Item[] = []
  const flush = () => {
    if (group) result.push({ kind: 'group', ...group }, ...deferred)
    group = null
    deferred = []
  }
  for (const item of items) {
    const tool = item.kind === 'message' ? collapsible(item.message) : null
    if (tool) {
      group ??= { group: { readPaths: new Set(), searches: 0, lists: 0 }, index: item.index }
      if (tool.kind === 'search') group.group.searches++
      else if (tool.kind === 'list') group.group.lists++
      // Unique files, so re-reading one file still counts once.
      else for (const path of (tool.detail || `#${item.index}`).split(', ')) group.group.readPaths.add(path)
      continue
    }
    if (group && item.kind === 'message' && item.message.role === 'thinking') {
      deferred.push(item)
      continue
    }
    flush()
    result.push(item)
  }
  flush()
  return result
}

/** `[verb, count, noun]` parts in Claude Code's order: searches, reads, then listings. */
function summaryParts(group: ToolGroup): [string, number, string][] {
  const parts: [string, number, string][] = []
  const reads = group.readPaths.size
  if (group.searches) parts.push(['searched for', group.searches, group.searches === 1 ? 'pattern' : 'patterns'])
  if (reads) parts.push(['read', reads, reads === 1 ? 'file' : 'files'])
  if (group.lists) parts.push(['listed', group.lists, group.lists === 1 ? 'directory' : 'directories'])
  return parts
}

const capitalize = (text: string) => text[0]!.toUpperCase() + text.slice(1)

/** `Searched for 2 patterns, read 3 files, listed 1 directory`. */
export function toolGroupSummary(group: ToolGroup): string {
  return summaryParts(group).map(([verb, count, noun], i) => `${i ? verb : capitalize(verb)} ${count} ${noun}`).join(', ')
}

/** One dim line summarizing a run of read-only tools, counts in bold; ctrl+o (full mode) shows each call. */
export function ToolGroupLine({ group, theme }: { group: ToolGroup; theme: ThemeName }) {
  const colors = getThemeColors(theme)
  return (
    <Box flexDirection="row" paddingLeft={2} gap={1}>
      <Text color={colors.primary}>{STATUS_ICONS.tool}</Text>
      <Text color={colors.textDim}>
        {summaryParts(group).map(([verb, count, noun], i) => (
          <Text key={noun}>{i ? `, ${verb}` : capitalize(verb)} <Text bold>{String(count)}</Text> {noun}</Text>
        ))}
        <Text color={colors.textSubtle}>{' (ctrl+o to expand)'}</Text>
      </Text>
    </Box>
  )
}
