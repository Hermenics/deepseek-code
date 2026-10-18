import { describe, expect, it } from 'bun:test'
import { Step } from '../src/tools/Step/Step.js'
import { allTools } from '../src/tools/index.js'
import { canUseTool } from '../src/ui/interactionMode.js'

describe('step tool', () => {
  it('accepts both labels and rejects a missing one', async () => {
    expect(await Step.execute({ active: 'Running tests', done: 'Ran tests' })).toBe('Step opened: Running tests')
    expect(await Step.execute({ active: 'Running tests' })).toStartWith('Error:')
  })

  it('is offered to the model and allowed in read-only modes', () => {
    expect(allTools.some((tool) => tool.name === 'step')).toBe(true)
    expect(canUseTool('review', 'step')).toBe(true)
    expect(canUseTool('plan', 'step')).toBe(true)
  })
})
