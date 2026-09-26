import { expect, test } from 'bun:test'
import React from 'react'
import { PassThrough } from 'node:stream'
import { invalidateInkFrame, renderSync } from '../../../src/ink/root.js'
import { AgentsOverview } from '../../../src/ui/agents/AgentsOverview.js'
import { InputBox } from '../../../src/ui/input/InputBox.js'
import type { SessionData } from '../../../src/agent/session.js'
import type { OverviewStatus } from '../../../src/ui/agents/overview.js'

class FakeTerminal extends PassThrough {
  isTTY = true
  isRaw = false
  columns = 120
  rows = 30
  setRawMode(enabled: boolean): this { this.isRaw = enabled; return this }
  ref(): this { return this }
  unref(): this { return this }
}

const session = (id: string, title: string, cwd = '/w/app'): SessionData => ({
  id, title, createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z', cwd, model: 'deepseek-v4', provider: 'deepseek',
  language: null, activeAgent: null, agentMessages: [], uiMessages: [{ role: 'user', content: `${title} prompt` }], filesModified: [],
})

function mount(element: React.ReactElement) {
  const stdin = new FakeTerminal()
  const stdout = new FakeTerminal()
  let out = ''
  stdout.on('data', chunk => { out += String(chunk) })
  const instance = renderSync(element, {
    stdin: stdin as unknown as NodeJS.ReadStream,
    stdout: stdout as unknown as NodeJS.WriteStream,
    stderr: stdout as unknown as NodeJS.WriteStream,
    exitOnCtrlC: false,
    patchConsole: false,
  })
  // Ink paints diffs; invalidating first makes the next paint a whole, readable frame.
  const frame = async () => {
    out = ''
    invalidateInkFrame(stdout as unknown as NodeJS.WriteStream)
    await Bun.sleep(60)
    return out.replace(/\x1b\[(\d*)C/g, (_, n) => ' '.repeat(Number(n || 1))).replace(/\x1b\[[?0-9;]*[a-zA-Z]/g, '')
  }
  const press = async (keys: string) => { stdin.write(keys); await Bun.sleep(60) }
  const cleanup = () => { stdout.isTTY = false; instance.unmount(); instance.cleanup() }
  return { frame, press, cleanup }
}

function overview(status: OverviewStatus, opened: SessionData[], extra: Partial<React.ComponentProps<typeof AgentsOverview>> = {}) {
  return (
    <AgentsOverview
      current={{ session: session('cur', 'Live task'), status }}
      listSaved={async () => [session('old', 'Saved task', '/w/other')]}
      theme="dark"
      onOpen={s => { opened.push(s) }}
      onNew={() => {}}
      onRename={async () => {}}
      onDelete={async () => {}}
      onClose={() => {}}
      {...extra}
    />
  )
}

test('shows status tabs with counts, grouped rows and details, and opens a saved session', async () => {
  const opened: SessionData[] = []
  const ui = mount(overview('ready', opened))
  try {
    await Bun.sleep(100)
    const screen = await ui.frame()
    expect(screen).toContain('Command center')
    expect(screen).toMatch(/All 2 +Needs you 0 +Working 0 +Ready 1 +Inactive 1/)
    expect(screen).toContain('Live task')
    expect(screen).toContain('current')
    expect(screen).toContain('Task details')
    await ui.press('\x1b[B')
    await ui.press('\r')
    expect(opened.map(s => s.id)).toEqual(['old'])
  } finally { ui.cleanup() }
})

test('refuses to switch away while the current session is working', async () => {
  const opened: SessionData[] = []
  const ui = mount(overview('working', opened))
  try {
    await Bun.sleep(100)
    await ui.press('\x1b[B')
    await ui.press('\r')
    expect(opened).toEqual([])
    expect(await ui.frame()).toContain('Finish or stop the current turn first')
  } finally { ui.cleanup() }
})

test('tab filters to a status', async () => {
  const ui = mount(overview('ready', []))
  try {
    await Bun.sleep(100)
    for (let i = 0; i < 4; i++) await ui.press('\t') // All → Needs you → Working → Ready → Inactive
    const screen = await ui.frame()
    expect(screen).toMatch(/Inactive 1/)
    expect(screen).toContain('Saved task')
    expect(screen).not.toContain('Live task')
  } finally { ui.cleanup() }
})

test('← on an empty prompt opens the command center, but not while typing', async () => {
  let agents = 0
  let activity = 0
  const ui = mount(
    <InputBox onSubmit={() => {}} isLoading={false} toolCallCount={0} workingDirectory={process.cwd()}
      activityAvailable onActivityOpen={() => { activity++ }} onAgentsOpen={() => { agents++ }} />,
  )
  try {
    await Bun.sleep(100)
    await ui.press('\x1b[D')
    expect([agents, activity]).toEqual([1, 0])
    await ui.press('\x1b[B')
    expect(activity).toBe(1)
    await ui.press('x')
    await ui.press('\x1b[D')
    expect(agents).toBe(1)
  } finally { ui.cleanup() }
})
