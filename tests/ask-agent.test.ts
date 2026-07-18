import { describe, it, expect } from 'bun:test'
import { AskAgent, setAgentNoteCallback } from '../src/tools/AskAgent/AskAgent.js'
import { OrchestratorSession } from '../src/orchestration/OrchestratorSession.js'

async function withBlockedScheduler<T>(run: (session: OrchestratorSession) => Promise<T>, maxTasks = 17): Promise<T> {
  const session = new OrchestratorSession({
    projectRoot: process.cwd(),
    logFile: null,
    limits: { concurrency: 1, maxTasks },
    settings: { agents: { concurrency: 1, maxTasks } },
  })
  const blocker = session.spawn({ type: 'test-blocker', timeoutMs: 5_000 }, ({ signal }) => new Promise<never>((_resolve, reject) => {
    if (signal.aborted) reject(signal.reason)
    else signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  }))
  while (blocker.status().state === 'queued') await Bun.sleep(1)
  try {
    return await run(session)
  } finally {
    await session.shutdown('Test cleanup')
  }
}

describe('AskAgent tool', () => {
  describe('schema', () => {
    it('has correct name', () => {
      expect(AskAgent.name).toBe('ask_agent')
    })

    it('has a non-empty description', () => {
      expect(typeof AskAgent.description).toBe('string')
      expect(AskAgent.description.length).toBeGreaterThan(0)
    })

    it('requires question parameter', () => {
      const params = AskAgent.parameters as any
      expect(params.required).toContain('question')
    })

    it('accepts dynamic registry agent names without a static enum', () => {
      const params = AskAgent.parameters as any
      expect(params.properties.agent.type).toBe('string')
      expect(params.properties.agent.enum).toBeUndefined()
    })

    it('has broadcast boolean param', () => {
      const params = AskAgent.parameters as any
      expect(params.properties.broadcast.type).toBe('boolean')
    })

    it('question is not in enum (free text)', () => {
      const params = AskAgent.parameters as any
      expect(params.properties.question.type).toBe('string')
      expect(params.properties.question.enum).toBeUndefined()
    })
  })

  describe('execute — invalid inputs', () => {
    it('returns error for invalid agent name', async () => {
      const result = await AskAgent.execute({ question: 'test?', agent: 'invalid' })
      expect(result).toContain('Error')
    })

    it('returns error when agent is omitted and broadcast is false', async () => {
      const result = await AskAgent.execute({ question: 'test?' })
      expect(result).toContain('Error')
    })

    it('returns error when agent is empty string', async () => {
      const result = await AskAgent.execute({ question: 'test?', agent: '' })
      expect(result).toContain('Error')
    })
  })

  describe('execute — single agent dispatch', () => {
    it('returns dispatch confirmation mentioning the agent name', async () => {
      await withBlockedScheduler(async session => {
        const result = await AskAgent.execute({ question: 'Is this safe?', agent: 'reviewer' }, session.toolContext())
        expect(result).toContain('@reviewer')
      })
    })

    it('mentions next turn in the response', async () => {
      await withBlockedScheduler(async session => {
        const result = await AskAgent.execute({ question: 'Is this safe?', agent: 'reviewer' }, session.toolContext())
        expect(result).toContain('next turn')
      })
    })

    it('works for coder agent', async () => {
      await withBlockedScheduler(async session => {
        const result = await AskAgent.execute({ question: 'How to fix this?', agent: 'coder' }, session.toolContext())
        expect(result).toContain('@coder')
      })
    })

    it('works for tester agent', async () => {
      await withBlockedScheduler(async session => {
        const result = await AskAgent.execute({ question: 'Write tests', agent: 'tester' }, session.toolContext())
        expect(result).toContain('@tester')
      })
    })

    it('returns an observable handle without starting the queued worker', async () => {
      await withBlockedScheduler(async session => {
        const start = Date.now()
        const result = JSON.parse(await AskAgent.execute({ question: 'Quick check', agent: 'coder' }, session.toolContext()))
        expect(Date.now() - start).toBeLessThan(500)
        expect(result.sessionId).toBe(session.sessionId)
        expect(result.state).toBe('queued')
        expect(session.registry.getStatus(result.taskId).state).toBe('queued')
      })
    })
  })

  describe('execute — broadcast', () => {
    it('mentions all 3 agents when broadcast=true', async () => {
      await withBlockedScheduler(async session => {
        const result = await AskAgent.execute({ question: 'Thoughts?', broadcast: true }, session.toolContext())
        expect(result).toContain('@coder')
        expect(result).toContain('@reviewer')
        expect(result).toContain('@tester')
      })
    })

    it('broadcast ignores agent param and fans out to all', async () => {
      await withBlockedScheduler(async session => {
        const result = await AskAgent.execute({ question: 'Thoughts?', agent: 'coder', broadcast: true }, session.toolContext())
        expect(result).toContain('@reviewer')
        expect(result).toContain('@tester')
      })
    })

    it('broadcast returns queued handles immediately', async () => {
      await withBlockedScheduler(async session => {
        const start = Date.now()
        const result = JSON.parse(await AskAgent.execute({ question: 'All agents check this', broadcast: true }, session.toolContext()))
        expect(Date.now() - start).toBeLessThan(500)
        expect(result.tasks.length).toBeGreaterThanOrEqual(3)
        expect(result.tasks.every((task: { state: string }) => task.state === 'queued')).toBe(true)
      })
    })

    it('preserves handles when only part of a broadcast can be scheduled', async () => {
      await withBlockedScheduler(async session => {
        const result = JSON.parse(await AskAgent.execute({ question: 'Bounded broadcast', broadcast: true }, session.toolContext()))
        expect(result.tasks).toHaveLength(1)
        expect(result.failures).toHaveLength(2)
        expect(session.registry.getStatus(result.tasks[0].taskId).state).toBe('queued')
      }, 2)
    })
  })

  describe('setAgentNoteCallback', () => {
    it('is a function', () => {
      expect(typeof setAgentNoteCallback).toBe('function')
    })

    it('accepts a callback without throwing', () => {
      expect(() => setAgentNoteCallback((name, text) => {})).not.toThrow()
    })
  })
})
