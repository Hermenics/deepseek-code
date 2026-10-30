import { afterEach, describe, expect, it } from 'bun:test'
import React from 'react'
import { PassThrough } from 'node:stream'
import { renderSync } from '../../src/ink/root.js'
import useInput from '../../src/ink/hooks/use-input.js'
import { ToolPermissionPrompt } from '../../src/ui/App.js'
import type { ToolPermissionRequest, ToolPermissionResult } from '../../src/agent/agent.js'

class FakeTerminal extends PassThrough {
  isTTY = true
  isRaw = false
  columns = 100
  rows = 24
  setRawMode(enabled: boolean): this { this.isRaw = enabled; return this }
  ref(): this { return this }
  unref(): this { return this }
}

describe('TUI tool permission prompt', () => {
  let terminal: FakeTerminal | undefined
  let output: FakeTerminal | undefined
  let cleanup: (() => void) | undefined

  afterEach(() => {
    if (output && cleanup) {
      output.isTTY = false
      cleanup()
    }
    terminal = undefined
    output = undefined
    cleanup = undefined
  })

  it('wraps browser batch details instead of hiding their middle', async () => {
    terminal = new FakeTerminal()
    output = new FakeTerminal()
    const request: ToolPermissionRequest = { toolName: 'browser', reason: 'risk', args: { action: 'batch', __origin: 'https://example.com', steps: [{ action: 'type', text: 'FIRST-' + 'x'.repeat(70) }, { action: 'upload', paths: ['MIDDLE.txt'] }, { action: 'type', text: 'LAST' }] } }
    const instance = renderSync(<ToolPermissionPrompt request={request} onDecide={() => {}} />, { stdin: terminal as unknown as NodeJS.ReadStream, stdout: output as unknown as NodeJS.WriteStream, stderr: output as unknown as NodeJS.WriteStream, exitOnCtrlC: false, patchConsole: false })
    cleanup = instance.cleanup
    let rendered = ''
    output.on('data', chunk => { rendered += chunk.toString() })
    await Bun.sleep(40)
    expect(rendered).toContain('MIDDLE.txt')
  })

  it('scrolls long browser batch details without hiding approval choices', async () => {
    terminal = new FakeTerminal()
    output = new FakeTerminal()
    output.columns = 60
    output.rows = 18
    const steps = Array.from({ length: 20 }, (_, i) => ({ action: 'upload', paths: [`file-${i.toString().padStart(2, '0')}.txt`] }))
    steps[19]!.paths = ['LAST-UNIQUE.txt']
    const request: ToolPermissionRequest = { toolName: 'browser', reason: 'risk', args: { action: 'batch', __origin: 'https://example.com', steps } }
    let propagated = 0
    function Observer() {
      useInput((_input, key) => { if (key.pageUp || key.pageDown) propagated++ })
      return null
    }
    const instance = renderSync(<><ToolPermissionPrompt request={request} onDecide={() => {}} /><Observer /></>, { stdin: terminal as unknown as NodeJS.ReadStream, stdout: output as unknown as NodeJS.WriteStream, stderr: output as unknown as NodeJS.WriteStream, exitOnCtrlC: false, patchConsole: false })
    cleanup = instance.cleanup
    let rendered = ''
    output.on('data', chunk => { rendered += chunk.toString() })
    await Bun.sleep(60)
    expect(rendered).toContain('file-00.txt')
    for (let i = 0; i < 6; i++) { terminal.write('\x1b[6~'); await Bun.sleep(40) }
    expect(rendered).toContain('LAST')
    expect(rendered).toContain('UNIQUE.txt')
    terminal.write('\x1b[5~')
    await Bun.sleep(40)
    expect(propagated).toBe(0)
    expect(rendered.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\s/g, '')).toContain('Denyandstopthisturn')
  })

  it('renders the approval choices and sends the selected result to the host', async () => {
    terminal = new FakeTerminal()
    output = new FakeTerminal()
    const decisions: ToolPermissionResult[] = []
    const request: ToolPermissionRequest = {
      toolName: 'web_fetch', args: { url: `https://example.com/${'x'.repeat(100)}/target.txt` }, reason: 'permission',
    }
    const instance = renderSync(
      <ToolPermissionPrompt request={request} onDecide={decision => decisions.push(decision)} />,
      {
        stdin: terminal as unknown as NodeJS.ReadStream,
        stdout: output as unknown as NodeJS.WriteStream,
        stderr: output as unknown as NodeJS.WriteStream,
        exitOnCtrlC: false,
        patchConsole: false,
      },
    )
    cleanup = instance.cleanup

    let rendered = ''
    output.on('data', chunk => { rendered += chunk.toString() })
    await Bun.sleep(40)
    const plain = rendered.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\s/g, '')
    expect(plain).toContain('Confirmationrequired')
    expect(plain).toContain('currentpermissionpolicyrequiresconfirmationforthisaction')
    expect(plain).toContain('target.txt')
    expect(plain).toContain('Denyandstopthisturn')

    terminal.write('1')
    await Bun.sleep(40)
    expect(decisions).toEqual(['once'])
  })

  it('offers an action-only denial that keeps the turn running', async () => {
    terminal = new FakeTerminal()
    output = new FakeTerminal()
    const decisions: ToolPermissionResult[] = []
    const instance = renderSync(
      <ToolPermissionPrompt
        request={{ toolName: 'web_fetch', args: { url: 'https://example.com' }, reason: 'permission' }}
        onDecide={decision => decisions.push(decision)}
      />,
      {
        stdin: terminal as unknown as NodeJS.ReadStream,
        stdout: output as unknown as NodeJS.WriteStream,
        stderr: output as unknown as NodeJS.WriteStream,
        exitOnCtrlC: false,
        patchConsole: false,
      },
    )
    cleanup = instance.cleanup

    let rendered = ''
    output.on('data', chunk => { rendered += chunk.toString() })
    await Bun.sleep(40)
    expect(rendered.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\s/g, '')).toContain('Denythisactionandcontinue')

    terminal.write('5')
    await Bun.sleep(40)
    expect(decisions).toEqual(['reject'])
  })
})
