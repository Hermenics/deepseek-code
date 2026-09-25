import { describe, expect, it } from 'bun:test'
import { closeSteps, interruptSteps, openStep, stepToolFlags } from '../../../src/ui/messages/steps.js'
import type { Message } from '../../../src/ui/App.js'

describe('steps', () => {
  it('closes the running step when the next one opens and at the end of the turn', () => {
    let messages: Message[] = [{ role: 'user', content: 'fix it' }]
    messages = openStep(messages, { active: 'Rodando os testes', done: 'Rodou os testes' })
    messages = openStep(messages, { active: 'Corrigindo o bug', done: 'Corrigiu o bug' })
    expect(messages.slice(1)).toEqual([
      { role: 'step', content: 'Rodou os testes' },
      { role: 'step', content: 'Corrigindo o bug', doneLabel: 'Corrigiu o bug' },
    ])
    const closed = closeSteps(messages)
    expect(closed[2]).toEqual({ role: 'step', content: 'Corrigiu o bug' })
    expect(closeSteps(closed)).toBe(closed)
  })

  it('flags only the tools inside a step of the same turn', () => {
    const messages: Message[] = [
      { role: 'user', content: 'a' },
      { role: 'tool', content: '✓ glob → *' },
      { role: 'step', content: 'Lendo', doneLabel: 'Leu' },
      { role: 'tool', content: '✓ read_file → a.ts' },
      { role: 'assistant', content: 'hmm' },
      { role: 'tool', content: '✓ grep → x' },
      { role: 'user', content: 'b' },
      { role: 'tool', content: '✓ shell → y' },
    ]
    expect(stepToolFlags(messages)).toEqual([false, false, false, true, false, true, false, false])
  })
  it('marks an interrupted step without claiming it finished', () => {
    const messages = openStep([{ role: 'user', content: 'a' }], { active: 'Rodando os testes', done: 'Rodou os testes' })
    expect(interruptSteps(messages)[1]).toEqual({ role: 'step', content: 'Rodando os testes', interrupted: true })
    expect(closeSteps(interruptSteps(messages))[1]).toEqual({ role: 'step', content: 'Rodando os testes', interrupted: true })
  })

  it('drops a trailing ellipsis the model wrote, since the heading animates its own', () => {
    expect(openStep([], { active: 'Rodando os testes...', done: 'Rodou' })[0]!.content).toBe('Rodando os testes')
    expect(openStep([], { active: 'Rodando os testes…', done: 'Rodou' })[0]!.content).toBe('Rodando os testes')
  })
})
