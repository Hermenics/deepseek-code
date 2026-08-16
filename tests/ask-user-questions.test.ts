import { describe, expect, it } from 'bun:test'
import { AskUserQuestions } from '../src/tools/AskUserQuestions/AskUserQuestions.js'

const questions = [{
  header: 'Runtime',
  question: 'Which runtime should this use?',
  type: 'choice' as const,
  options: [
    { label: 'Bun', description: 'Fast JavaScript runtime.' },
    { label: 'Node', description: 'Broad ecosystem compatibility.' },
  ],
}]

describe('ask_user_questions', () => {
  it('waits for the interactive handler and returns indexed answers', async () => {
    const result = await AskUserQuestions.execute({ questions }, {
      sessionId: 'test',
      projectRoot: process.cwd(),
      workspacePath: process.cwd(),
      permissionProfile: 'coordinator-integrator',
      askUser: async (received) => {
        expect(received).toEqual(questions)
        return { '0': 'Bun' }
      },
    })

    expect(JSON.parse(result)).toEqual({ answers: { '0': 'Bun' }, cancelled: false })
  })

  it('returns a cancellation result when the user dismisses the prompt', async () => {
    const result = await AskUserQuestions.execute({ questions }, {
      sessionId: 'test',
      projectRoot: process.cwd(),
      workspacePath: process.cwd(),
      permissionProfile: 'coordinator-integrator',
      askUser: async () => null,
    })

    expect(JSON.parse(result)).toEqual({ answers: {}, cancelled: true })
  })

  it('fails clearly when called without an interactive handler', async () => {
    await expect(AskUserQuestions.execute({ questions })).resolves.toContain('unavailable')
  })

  it('rejects empty and oversized question lists before per-question validation', async () => {
    await expect(AskUserQuestions.execute({ questions: [] })).resolves.toBe('Error: questions must contain between 1 and 4 entries.')
    await expect(AskUserQuestions.execute({ questions: [null, null, null, null, null] })).resolves.toBe('Error: questions must contain between 1 and 4 entries.')
  })

  it('propagates the abort signal to the interactive handler', async () => {
    const controller = new AbortController()
    const pending = AskUserQuestions.execute({ questions }, {
      sessionId: 'test',
      projectRoot: process.cwd(),
      workspacePath: process.cwd(),
      permissionProfile: 'coordinator-integrator',
      signal: controller.signal,
      askUser: async (_received, signal) => new Promise((resolve) => {
        signal?.addEventListener('abort', () => resolve(null), { once: true })
      }),
    })
    controller.abort()
    expect(JSON.parse(await pending)).toEqual({ answers: {}, cancelled: true })
  })
})
