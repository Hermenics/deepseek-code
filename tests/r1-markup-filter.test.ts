import { describe, it, expect } from 'bun:test'
import { createR1MarkupFilter } from '../src/agent/agent.js'

function collect() {
  const text: string[] = []
  const think: string[] = []
  const filter = createR1MarkupFilter((t) => text.push(t), (t) => think.push(t))
  return { filter, text: () => text.join(''), think: () => think.join('\n') }
}

describe('createR1MarkupFilter', () => {
  it('passes plain text straight through', () => {
    const c = collect()
    c.filter.push('hello ')
    c.filter.push('world')
    c.filter.flush()
    expect(c.text()).toBe('hello world')
    expect(c.think()).toBe('')
  })

  it('routes a complete <think> block to onThink, never to onText', () => {
    const c = collect()
    c.filter.push('before <think>secret reasoning</think> after')
    c.filter.flush()
    expect(c.text()).toBe('before  after')
    expect(c.think()).toBe('secret reasoning')
  })

  it('drops <tool_call> blocks entirely', () => {
    const c = collect()
    c.filter.push('ok <tool_call><name>read_file</name><args>{}</args></tool_call> done')
    c.filter.flush()
    expect(c.text()).toBe('ok  done')
    expect(c.text()).not.toContain('tool_call')
  })

  it('holds text back while a block is still open', () => {
    const c = collect()
    c.filter.push('visible <think>partial')
    expect(c.text()).toBe('visible ')
    expect(c.think()).toBe('')
    c.filter.push(' reasoning</think> tail')
    expect(c.think()).toBe('partial reasoning')
    expect(c.text()).toBe('visible  tail')
  })

  it('handles a tag split across pushes', () => {
    const c = collect()
    c.filter.push('a <to')
    expect(c.text()).toBe('a ')
    c.filter.push('ol_call>x</tool_call>b')
    c.filter.flush()
    expect(c.text()).toBe('a b')
  })

  it('does not swallow ordinary angle brackets', () => {
    const c = collect()
    c.filter.push('if (a < b) return <div>hi</div>')
    c.filter.flush()
    expect(c.text()).toBe('if (a < b) return <div>hi</div>')
  })

  it('unwraps <response> tags', () => {
    const c = collect()
    c.filter.push('<response>the answer</response>')
    c.filter.flush()
    expect(c.text()).toBe('the answer')
  })

  it('keeps truncated reasoning out of the text at end of stream', () => {
    const c = collect()
    c.filter.push('tail <think>cut off')
    c.filter.flush()
    expect(c.text()).toBe('tail ')
    expect(c.think()).toBe('cut off')
  })

  it('drops a truncated tool_call at end of stream', () => {
    const c = collect()
    c.filter.push('tail <tool_call><name>read_file')
    c.filter.flush()
    expect(c.text()).toBe('tail ')
    expect(c.think()).toBe('')
  })

  it('drops a tag that never finished arriving', () => {
    const c = collect()
    c.filter.push('tail <thin')
    c.filter.flush()
    expect(c.text()).toBe('tail ')
  })

  it('emits nothing extra on an empty flush', () => {
    const c = collect()
    c.filter.flush()
    expect(c.text()).toBe('')
    expect(c.think()).toBe('')
  })
})
