import { describe, expect, it } from 'bun:test'
import { renderHook } from '../../helpers/renderHook.js'
import { useInputBuffer } from '../../../src/ui/input/hooks/useInputBuffer.js'
import { useInputHistory } from '../../../src/ui/input/hooks/useInputHistory.js'
import { useSubagents } from '../../../src/ui/subagent/useSubagents.js'

describe('input hooks keep their state across renders', () => {
  it('useInputBuffer keeps its undo history', () => {
    const { result, rerender, unmount } = renderHook(() => useInputBuffer())
    try {
      result.current.pushToBuffer('hello', 5)
      result.current.pushToBuffer('world', 5)
      rerender()
      expect(result.current.canUndo).toBe(true)
      expect(result.current.undo()?.text).toBe('hello')
    } finally { unmount() }
  })

  it('useInputHistory keeps its navigation position', () => {
    const entries = ['first', 'second']
    const { result, rerender, unmount } = renderHook(() => useInputHistory({ entries }))
    try {
      expect(result.current.historyUp('draft')).toBe('second')
      rerender()
      expect(result.current.isNavigating).toBe(true)
      expect(result.current.historyUp('draft')).toBe('first')
    } finally { unmount() }
  })

  it('useSubagents returns the same store on every render', () => {
    const { result, rerender, unmount } = renderHook(() => useSubagents())
    try {
      const first = result.current
      first.onSubagentStart({ id: 'a1', task: 'Review' })
      rerender()
      expect(result.current).toBe(first)
      expect(result.current.agents.map((agent) => agent.id)).toEqual(['a1'])
    } finally { unmount() }
  })
})
