import { describe, it, expect, beforeEach } from 'bun:test'
import { useSubagents } from '../../../src/ui/subagent/useSubagents.js'
import type { UseSubagentsReturn } from '../../../src/ui/subagent/useSubagents.js'
import type { SubagentState } from '../../../src/ui/subagent/types.js'

function createHook(): UseSubagentsReturn {
  return useSubagents()
}

describe('useSubagents', () => {
  describe('onSubagentStart', () => {
    it('should add agent with status running', () => {
      const hook = createHook()

      hook.onSubagentStart({ id: 'a1', task: 'fetch data' })

      expect(hook.agents).toHaveLength(1)
      expect(hook.agents[0].id).toBe('a1')
      expect(hook.agents[0].task).toBe('fetch data')
      expect(hook.agents[0].status).toBe('running')
    })

    it('should set toolCount to 0 and lastToolInfo to null on start', () => {
      const hook = createHook()

      hook.onSubagentStart({ id: 'a1', task: 'some task' })

      expect(hook.agents[0].toolCount).toBe(0)
      expect(hook.agents[0].lastToolInfo).toBeNull()
    })

    it('should set result and error to null on start', () => {
      const hook = createHook()

      hook.onSubagentStart({ id: 'a1', task: 'some task' })

      expect(hook.agents[0].result).toBeNull()
      expect(hook.agents[0].error).toBeNull()
    })

    it('should assign colorIndex 0 to first agent', () => {
      const hook = createHook()

      hook.onSubagentStart({ id: 'a1', task: 'task 1' })

      expect(hook.agents[0].colorIndex).toBe(0)
    })

    it('should assign colorIndex 1 to second agent', () => {
      const hook = createHook()

      hook.onSubagentStart({ id: 'a1', task: 'task 1' })
      hook.onSubagentStart({ id: 'a2', task: 'task 2' })

      expect(hook.agents[1].colorIndex).toBe(1)
    })

    it('should assign colorIndex incrementally to multiple agents', () => {
      const hook = createHook()

      hook.onSubagentStart({ id: 'a1', task: 'task 1' })
      hook.onSubagentStart({ id: 'a2', task: 'task 2' })
      hook.onSubagentStart({ id: 'a3', task: 'task 3' })

      expect(hook.agents[0].colorIndex).toBe(0)
      expect(hook.agents[1].colorIndex).toBe(1)
      expect(hook.agents[2].colorIndex).toBe(2)
    })

    it('should record startedAt as a number', () => {
      const hook = createHook()
      const before = Date.now()

      hook.onSubagentStart({ id: 'a1', task: 'task' })

      const after = Date.now()
      expect(typeof hook.agents[0].startedAt).toBe('number')
      expect(hook.agents[0].startedAt).toBeGreaterThanOrEqual(before)
      expect(hook.agents[0].startedAt).toBeLessThanOrEqual(after)
    })

    it('should set durationMs to null on start', () => {
      const hook = createHook()

      hook.onSubagentStart({ id: 'a1', task: 'task' })

      expect(hook.agents[0].durationMs).toBeNull()
    })

    it('should retain runtime identity and workspace details', () => {
      const hook = createHook()
      hook.onSubagentStart({ id: 'a1', task: 'task', agentName: 'coder', mode: 'background', model: 'deepseek-reasoner', workspace: '/tmp/worktree', workflowRunId: 'workflow-1' })

      expect(hook.agents[0]).toMatchObject({ agentName: 'coder', mode: 'background', model: 'deepseek-reasoner', workspace: '/tmp/worktree', workflowRunId: 'workflow-1' })
    })
  })

  describe('onSubagentProgress', () => {
    it('should update lastToolInfo when progress event fires', () => {
      const hook = createHook()

      hook.onSubagentStart({ id: 'a1', task: 'task' })
      hook.onSubagentProgress({ id: 'a1', info: 'reading file...' })

      expect(hook.agents[0].lastToolInfo).toBe('reading file...')
    })

    it('should not affect other agents when updating one', () => {
      const hook = createHook()

      hook.onSubagentStart({ id: 'a1', task: 'task 1' })
      hook.onSubagentStart({ id: 'a2', task: 'task 2' })
      hook.onSubagentProgress({ id: 'a1', info: 'working...' })

      expect(hook.agents[1].lastToolInfo).toBeNull()
    })
  })

  describe('onSubagentToolUse', () => {
    it('should increment toolCount on tool use', () => {
      const hook = createHook()

      hook.onSubagentStart({ id: 'a1', task: 'task' })
      hook.onSubagentToolUse({ id: 'a1', tool: 'read_file', info: 'src/index.ts' })

      expect(hook.agents[0].toolCount).toBe(1)
    })

    it('should increment toolCount on each tool use', () => {
      const hook = createHook()

      hook.onSubagentStart({ id: 'a1', task: 'task' })
      hook.onSubagentToolUse({ id: 'a1', tool: 'read_file', info: 'file.ts' })
      hook.onSubagentToolUse({ id: 'a1', tool: 'shell', info: 'ls' })
      hook.onSubagentToolUse({ id: 'a1', tool: 'write_file', info: 'out.ts' })

      expect(hook.agents[0].toolCount).toBe(3)
    })

    it('should update lastToolInfo with tool info on tool use', () => {
      const hook = createHook()

      hook.onSubagentStart({ id: 'a1', task: 'task' })
      hook.onSubagentToolUse({ id: 'a1', tool: 'shell', info: 'git status' })

      expect(hook.agents[0].lastToolInfo).toBe('git status')
    })

    it('should not affect toolCount of other agents', () => {
      const hook = createHook()

      hook.onSubagentStart({ id: 'a1', task: 'task 1' })
      hook.onSubagentStart({ id: 'a2', task: 'task 2' })
      hook.onSubagentToolUse({ id: 'a1', tool: 'read_file', info: 'file.ts' })

      expect(hook.agents[1].toolCount).toBe(0)
    })
  })

  describe('onSubagentDone', () => {
    it('should set status to done', () => {
      const hook = createHook()

      hook.onSubagentStart({ id: 'a1', task: 'task' })
      hook.onSubagentDone({ id: 'a1', result: 'completed successfully' })

      expect(hook.agents[0].status).toBe('done')
    })

    it('should set result on done', () => {
      const hook = createHook()

      hook.onSubagentStart({ id: 'a1', task: 'task' })
      hook.onSubagentDone({ id: 'a1', result: 'all good' })

      expect(hook.agents[0].result).toBe('all good')
    })

    it('should set durationMs as a positive number on done', () => {
      const hook = createHook()

      hook.onSubagentStart({ id: 'a1', task: 'task' })
      hook.onSubagentDone({ id: 'a1', result: 'done' })

      expect(hook.agents[0].durationMs).not.toBeNull()
      expect(hook.agents[0].durationMs!).toBeGreaterThanOrEqual(0)
    })

    it('should not affect other agents when one finishes', () => {
      const hook = createHook()

      hook.onSubagentStart({ id: 'a1', task: 'task 1' })
      hook.onSubagentStart({ id: 'a2', task: 'task 2' })
      hook.onSubagentDone({ id: 'a1', result: 'done' })

      expect(hook.agents[1].status).toBe('running')
    })
  })

  describe('onSubagentError', () => {
    it('should set status to error', () => {
      const hook = createHook()

      hook.onSubagentStart({ id: 'a1', task: 'task' })
      hook.onSubagentError({ id: 'a1', error: 'network timeout' })

      expect(hook.agents[0].status).toBe('error')
    })

    it('should set error message', () => {
      const hook = createHook()

      hook.onSubagentStart({ id: 'a1', task: 'task' })
      hook.onSubagentError({ id: 'a1', error: 'network timeout' })

      expect(hook.agents[0].error).toBe('network timeout')
    })

    it('should set durationMs on error', () => {
      const hook = createHook()

      hook.onSubagentStart({ id: 'a1', task: 'task' })
      hook.onSubagentError({ id: 'a1', error: 'timeout' })

      expect(hook.agents[0].durationMs).not.toBeNull()
      expect(hook.agents[0].durationMs!).toBeGreaterThanOrEqual(0)
    })

    it('should not affect other agents when one errors', () => {
      const hook = createHook()

      hook.onSubagentStart({ id: 'a1', task: 'task 1' })
      hook.onSubagentStart({ id: 'a2', task: 'task 2' })
      hook.onSubagentError({ id: 'a1', error: 'fail' })

      expect(hook.agents[1].status).toBe('running')
      expect(hook.agents[1].error).toBeNull()
    })
  })

  describe('onSubagentMessage', () => {
    it('should seed messages with the task on start', () => {
      const hook = createHook()

      hook.onSubagentStart({ id: 'a1', task: 'fetch data' })

      expect(hook.agents[0].messages).toEqual([{ role: 'user', content: 'fetch data' }])
    })

    it('should append a message to agent.messages', () => {
      const hook = createHook()
      hook.onSubagentStart({ id: 'a1', task: 'task' })

      hook.onSubagentMessage({ id: 'a1', role: 'assistant', content: 'working...' })

      expect(hook.agents[0].messages).toEqual([
        { role: 'user', content: 'task' },
        { role: 'assistant', content: 'working...' },
      ])
    })

    it('should create the messages array when missing', () => {
      const hook = createHook()
      // Legacy/restored agent states may lack the messages field entirely.
      hook.agents.push({ id: 'a1', task: 'task', status: 'running' } as SubagentState)

      hook.onSubagentMessage({ id: 'a1', role: 'user', content: 'more detail' })

      expect(hook.agents[0].messages).toEqual([{ role: 'user', content: 'more detail' }])
    })

    it('should ignore messages for unknown agents', () => {
      const hook = createHook()

      hook.onSubagentMessage({ id: 'nope', role: 'assistant', content: 'x' })

      expect(hook.agents).toHaveLength(0)
    })
  })

  describe('onSubagentState', () => {
    it('should update tokens progressively without clobbering status', () => {
      const hook = createHook()
      hook.onSubagentStart({ id: 'a1', task: 'task' })
      hook.onSubagentState({ id: 'a1', tokens: 12_000 })

      expect(hook.agents[0].tokens).toBe(12_000)
      expect(hook.agents[0].status).toBe('running')
    })

    it('should accumulate growing token counts on repeated progress events', () => {
      const hook = createHook()
      hook.onSubagentStart({ id: 'a1', task: 'task' })
      hook.onSubagentState({ id: 'a1', tokens: 12_000 })
      hook.onSubagentState({ id: 'a1', tokens: 24_500 })

      expect(hook.agents[0].tokens).toBe(24_500)
    })

    it('should update status and tokens together when both are provided', () => {
      const hook = createHook()
      hook.onSubagentStart({ id: 'a1', task: 'task' })
      hook.onSubagentState({ id: 'a1', status: 'done', tokens: 30_000 })

      expect(hook.agents[0].status).toBe('done')
      expect(hook.agents[0].tokens).toBe(30_000)
    })
  })

  describe('clearResolved', () => {
    it('should remove agents with status done', () => {
      const hook = createHook()

      hook.onSubagentStart({ id: 'a1', task: 'task' })
      hook.onSubagentDone({ id: 'a1', result: 'done' })
      hook.clearResolved()

      expect(hook.agents).toHaveLength(0)
    })

    it('should remove agents with status error', () => {
      const hook = createHook()

      hook.onSubagentStart({ id: 'a1', task: 'task' })
      hook.onSubagentError({ id: 'a1', error: 'fail' })
      hook.clearResolved()

      expect(hook.agents).toHaveLength(0)
    })

    it('should keep agents with status running', () => {
      const hook = createHook()

      hook.onSubagentStart({ id: 'a1', task: 'task' })
      hook.clearResolved()

      expect(hook.agents).toHaveLength(1)
      expect(hook.agents[0].status).toBe('running')
    })

    it('should only remove resolved agents and keep running ones', () => {
      const hook = createHook()

      hook.onSubagentStart({ id: 'a1', task: 'task 1' })
      hook.onSubagentStart({ id: 'a2', task: 'task 2' })
      hook.onSubagentStart({ id: 'a3', task: 'task 3' })
      hook.onSubagentDone({ id: 'a1', result: 'done' })
      hook.onSubagentError({ id: 'a3', error: 'fail' })
      hook.clearResolved()

      expect(hook.agents).toHaveLength(1)
      expect(hook.agents[0].id).toBe('a2')
      expect(hook.agents[0].status).toBe('running')
    })

    it('should preserve resolved workflow agents for the workflow monitor', () => {
      const hook = createHook()
      hook.onSubagentStart({ id: 'a1', task: 'workflow task', workflowRunId: 'workflow-1' })
      hook.onSubagentDone({ id: 'a1', result: 'done' })

      hook.clearResolved()

      expect(hook.agents).toHaveLength(1)
    })
  })

  describe('multiple simultaneous agents', () => {
    it('should maintain independent states for each agent', () => {
      const hook = createHook()

      hook.onSubagentStart({ id: 'a1', task: 'fetch API' })
      hook.onSubagentStart({ id: 'a2', task: 'write file' })
      hook.onSubagentStart({ id: 'a3', task: 'run tests' })

      hook.onSubagentToolUse({ id: 'a1', tool: 'fetch', info: 'https://api.example.com' })
      hook.onSubagentToolUse({ id: 'a1', tool: 'fetch', info: 'https://api.example.com/2' })
      hook.onSubagentToolUse({ id: 'a2', tool: 'write_file', info: 'output.ts' })

      hook.onSubagentDone({ id: 'a2', result: 'file written' })
      hook.onSubagentError({ id: 'a3', error: 'test runner crashed' })

      const a1 = hook.agents.find(a => a.id === 'a1')!
      const a2 = hook.agents.find(a => a.id === 'a2')!
      const a3 = hook.agents.find(a => a.id === 'a3')!

      expect(a1.status).toBe('running')
      expect(a1.toolCount).toBe(2)

      expect(a2.status).toBe('done')
      expect(a2.result).toBe('file written')
      expect(a2.toolCount).toBe(1)

      expect(a3.status).toBe('error')
      expect(a3.error).toBe('test runner crashed')
      expect(a3.toolCount).toBe(0)
    })
  })
  describe('label and prompt separation', () => {
    it('seeds the transcript with the real instruction while task stays the short label', () => {
      const hook = useSubagents()

      hook.onSubagentStart({ id: 'a1', task: 'alpha:red', prompt: 'Return exactly one word. Use NO tools.' })

      const agent = hook.agents.find(a => a.id === 'a1')!
      // Lists render `task`, so it must remain the short label the workflow supplied.
      expect(agent.task).toBe('alpha:red')
      expect(agent.prompt).toBe('Return exactly one word. Use NO tools.')
      expect(agent.messages?.[0]).toEqual({ role: 'user', content: 'Return exactly one word. Use NO tools.' })
    })

    it('falls back to the task when no prompt was captured', () => {
      const hook = useSubagents()

      hook.onSubagentStart({ id: 'a1', task: 'Review the diff' })

      const agent = hook.agents.find(a => a.id === 'a1')!
      expect(agent.prompt).toBeNull()
      expect(agent.messages?.[0]).toEqual({ role: 'user', content: 'Review the diff' })
    })

    it('backfills the prompt when it arrives on a later state update', () => {
      const hook = useSubagents()

      hook.onSubagentStart({ id: 'a1', task: 'alpha:red' })
      hook.onSubagentState({ id: 'a1', status: 'done', prompt: 'Return exactly one word.' })

      expect(hook.agents.find(a => a.id === 'a1')!.prompt).toBe('Return exactly one word.')
    })
  })
})
