import { describe, it, expect } from 'bun:test'
import React from 'react'
import { SubagentList } from '../../../src/ui/subagent/SubagentList.js'
import { SubagentLine } from '../../../src/ui/subagent/SubagentLine.js'
import type { SubagentState } from '../../../src/ui/subagent/types.js'

// SubagentList é um componente React puro (sem hooks).
// Podemos chamá-lo como função e inspecionar o React element tree resultante.
// Isso verifica: quantos SubagentLines são criados e quais props recebem.

function makeAgent(id: string, overrides: Partial<SubagentState> = {}): SubagentState {
  return {
    id,
    task: `task for ${id}`,
    status: 'running',
    colorIndex: 0,
    toolCount: 0,
    lastToolInfo: null,
    startedAt: Date.now(),
    durationMs: null,
    result: null,
    error: null,
    ...overrides,
  }
}

// Extrai os SubagentLine elements da árvore de Box wrappers
function extractSubagentLineProps(element: React.ReactElement | null): Array<{ agent: SubagentState; isLast: boolean; theme: string }> {
  if (!element) return []
  const boxes = (element.props as { children: React.ReactElement[] }).children
  if (!Array.isArray(boxes)) return []
  return boxes.map((box: React.ReactElement) => (box.props as { children: React.ReactElement }).children.props as { agent: SubagentState; isLast: boolean; theme: string })
}

describe('SubagentList', () => {
  describe('module exports', () => {
    it('should export SubagentList as a function', () => {
      expect(typeof SubagentList).toBe('function')
    })
  })

  describe('empty array', () => {
    it('should return null when agents array is empty', () => {
      const result = SubagentList({ agents: [], theme: 'dark' })
      expect(result).toBeNull()
    })

    it('should not throw when agents array is empty', () => {
      expect(() => SubagentList({ agents: [], theme: 'dark' })).not.toThrow()
    })
  })

  describe('single agent', () => {
    it('should render one SubagentLine for one agent', () => {
      const agents = [makeAgent('a1')]
      const element = SubagentList({ agents, theme: 'dark' })
      const lineProps = extractSubagentLineProps(element)
      expect(lineProps).toHaveLength(1)
    })

    it('should mark the single agent as isLast=true', () => {
      const agents = [makeAgent('a1')]
      const element = SubagentList({ agents, theme: 'dark' })
      const lineProps = extractSubagentLineProps(element)
      expect(lineProps[0].isLast).toBe(true)
    })

    it('should pass correct agent data', () => {
      const agents = [makeAgent('a1')]
      const element = SubagentList({ agents, theme: 'dark' })
      const lineProps = extractSubagentLineProps(element)
      expect(lineProps[0].agent.id).toBe('a1')
      expect(lineProps[0].agent.task).toBe('task for a1')
    })
  })

  describe('multiple agents', () => {
    it('should render 3 SubagentLines for 3 agents', () => {
      const agents = [makeAgent('a1'), makeAgent('a2'), makeAgent('a3')]
      const element = SubagentList({ agents, theme: 'dark' })
      const lineProps = extractSubagentLineProps(element)
      expect(lineProps).toHaveLength(3)
    })

    it('should mark only the last agent with isLast=true', () => {
      const agents = [makeAgent('a1'), makeAgent('a2'), makeAgent('a3')]
      const element = SubagentList({ agents, theme: 'dark' })
      const lineProps = extractSubagentLineProps(element)
      expect(lineProps[2].isLast).toBe(true)
    })

    it('should mark non-last agents with isLast=false', () => {
      const agents = [makeAgent('a1'), makeAgent('a2'), makeAgent('a3')]
      const element = SubagentList({ agents, theme: 'dark' })
      const lineProps = extractSubagentLineProps(element)
      expect(lineProps[0].isLast).toBe(false)
      expect(lineProps[1].isLast).toBe(false)
    })

    it('should not mark first agent as isLast when there are multiple agents', () => {
      const agents = [makeAgent('a1'), makeAgent('a2')]
      const element = SubagentList({ agents, theme: 'dark' })
      const lineProps = extractSubagentLineProps(element)
      expect(lineProps[0].isLast).toBe(false)
      expect(lineProps[1].isLast).toBe(true)
    })

    it('should pass each agent to the corresponding SubagentLine', () => {
      const agents = [makeAgent('a1'), makeAgent('a2'), makeAgent('a3')]
      const element = SubagentList({ agents, theme: 'dark' })
      const lineProps = extractSubagentLineProps(element)
      expect(lineProps[0].agent.id).toBe('a1')
      expect(lineProps[1].agent.id).toBe('a2')
      expect(lineProps[2].agent.id).toBe('a3')
    })
  })

  describe('theme propagation', () => {
    it('should pass theme to each SubagentLine', () => {
      const agents = [makeAgent('a1'), makeAgent('a2')]
      const element = SubagentList({ agents, theme: 'light' })
      const lineProps = extractSubagentLineProps(element)
      expect(lineProps[0].theme).toBe('light')
      expect(lineProps[1].theme).toBe('light')
    })

    it('should not throw with dark theme', () => {
      const agents = [makeAgent('a1')]
      expect(() => SubagentList({ agents, theme: 'dark' })).not.toThrow()
    })
  })
})
