import { describe, expect, it, beforeEach, afterEach } from 'bun:test'
import React from 'react'
import { PassThrough } from 'stream'
import { renderSync, invalidateInkFrame } from '../../../src/ink/root.js'
import { MessageList, formatToolLine, shouldShowWorkDivider } from '../../../src/ui/messages/MessageList.js'
import type { Message } from '../../../src/ui/App.js'

describe('shouldShowWorkDivider', () => {
  it('divides a final assistant reply after tool work, but not a conversational turn', () => {
    const worked: Message[] = [
      { role: 'user', content: 'fix it' },
      { role: 'tool', content: '✓ patch_file → changed' },
      { role: 'thinking', content: 'checking' },
      { role: 'assistant', content: 'done' },
    ]
    const conversation: Message[] = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
    ]

    expect(shouldShowWorkDivider(worked, 3)).toBe(true)
    expect(shouldShowWorkDivider(conversation, 1)).toBe(false)
  })
})

describe('formatToolLine', () => {
  it('truncates a long arg to 60 chars by default, but returns it whole in full mode', () => {
    const longArg = 'a'.repeat(70)
    const detail = JSON.stringify({ arg: longArg, output: 'ok' })

    const collapsed = formatToolLine('my_tool', detail)
    expect(collapsed.arg).toBe('a'.repeat(60) + '...')
    expect(collapsed.arg).toHaveLength(63)
    expect(collapsed.output).toBe('ok')

    const full = formatToolLine('my_tool', detail, true)
    expect(full.arg).toBe(longArg)
    expect(full.output).toBe('ok')
  })

  it('truncates a long raw detail by default, but returns it whole in full mode', () => {
    const rawDetail = 'z'.repeat(70)

    const collapsed = formatToolLine('my_tool', rawDetail)
    expect(collapsed.arg).toBe('z'.repeat(60) + '...')

    const full = formatToolLine('my_tool', rawDetail, true)
    expect(full.arg).toBe(rawDetail)
  })
})

class FakeTerminal extends PassThrough {
  isTTY = true
  isRaw = false

  constructor(
    public columns = 120,
    public rows = 10,
  ) {
    super()
  }

  setRawMode(enabled: boolean): this {
    this.isRaw = enabled
    return this
  }
}

const waitForRenderer = () => new Promise(resolve => setTimeout(resolve, 0))

/**
 * Ink writes each word as a separate cursor-positioned run, so a single Text
 * becomes e.g. `Thought\x1b[1Cfor\x1b[1C7...` (CSI C = cursor forward N = N spaces).
 * Reconstruct the visible text so assertions match what a human sees.
 */
function normalizeTerminal(raw: string): string {
  return raw
    .replace(/\x1b\[\?[0-9;]*[a-zA-Z]/g, '')            // private CSI (?2026h, ?25l)
    .replace(/\x1b\[[0-9;]*m/g, '')                     // SGR colors
    .replace(/\x1b\[([0-9]+)C/g, (_, n: string) => ' '.repeat(Number(n))) // cursor forward → spaces
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')              // any remaining CSI
}

async function renderMessageList(props: {
  messages: Message[]
  streamText?: string
  thinkingText?: string
  fullMode?: boolean
  thinkingStartedAt?: number | null
}) {
  const stdout = new FakeTerminal(120, 10)
  const chunks: string[] = []
  stdout.on('data', chunk => chunks.push(String(chunk)))

  const instance = renderSync(
    React.createElement(MessageList, {
      messages: props.messages,
      streamText: props.streamText ?? '',
      thinkingText: props.thinkingText,
      fullMode: props.fullMode,
      thinkingStartedAt: props.thinkingStartedAt,
      theme: 'dark',
    }),
    {
      stdout: stdout as unknown as NodeJS.WriteStream,
      stdin: stdout as unknown as NodeJS.ReadStream,
      stderr: stdout as unknown as NodeJS.WriteStream,
      exitOnCtrlC: false,
      patchConsole: false,
    },
  )

  await waitForRenderer()

  return {
    text: normalizeTerminal(chunks.join('')),
    // Re-read later output so live components (useClock) can emit new frames.
    read: () => normalizeTerminal(chunks.join('')),
    stdout,
    cleanup: () => {
      stdout.isTTY = false
      instance.unmount()
      instance.cleanup()
    },
  }
}

describe('MessageList render', () => {
  const origColumns = process.stdout.columns

  beforeEach(() => {
    // MessageList reads process.stdout.columns directly (MessageList.tsx:46,211);
    // the FakeTerminal only controls Ink layout, not process.stdout.columns.
    (process.stdout as { columns?: number }).columns = 120
  })
  afterEach(() => {
    (process.stdout as { columns?: number }).columns = origColumns
  })

  it('collapses a persisted thinking message into a single line with its total duration', async () => {
    const { text, cleanup } = await renderMessageList({
      messages: [{ role: 'thinking', content: 'secret reasoning about the bug', thinkingMs: 7000 }],
    })
    try {
      expect(text).toContain('Thought for 7 seconds (ctrl+o to expand)')
      expect(text).not.toContain('secret reasoning about the bug')
    } finally {
      cleanup()
    }
  })

  it('expands a persisted thinking message in full mode', async () => {
    const { text, cleanup } = await renderMessageList({
      messages: [{ role: 'thinking', content: 'secret reasoning about the bug', thinkingMs: 7000 }],
      fullMode: true,
    })
    try {
      expect(text).toContain('secret reasoning about the bug')
      expect(text).not.toContain('ctrl+o to expand')
    } finally {
      cleanup()
    }
  })

  it('shows a generic thought line when no duration is known', async () => {
    const { text, cleanup } = await renderMessageList({
      messages: [{ role: 'thinking', content: 'reasoning without a timer' }],
    })
    try {
      expect(text).toContain('Thought (ctrl+o to expand)')
      expect(text).not.toContain('reasoning without a timer')
    } finally {
      cleanup()
    }
  })

  it('truncates tool output to 5 lines normally but shows every line in full mode', async () => {
    const output = Array.from({ length: 8 }, (_, i) => 'output-line-' + (i + 1)).join('\n')
    const toolMsg: Message = { role: 'tool', content: '✓ my_tool → ' + JSON.stringify({ arg: 'short', output }) }

    const normal = await renderMessageList({ messages: [toolMsg] })
    try {
      expect(normal.text).toContain('… 3 more lines')
      expect(normal.text).toContain('output-line-1')
      expect(normal.text).not.toContain('output-line-8')
    } finally {
      normal.cleanup()
    }

    const full = await renderMessageList({ messages: [toolMsg], fullMode: true })
    try {
      expect(full.text).toContain('output-line-8')
      expect(full.text).not.toContain('more lines')
    } finally {
      full.cleanup()
    }
  })

  it('shows a live counting timer while thinking streams', async () => {
    const { text, cleanup } = await renderMessageList({
      messages: [],
      thinkingText: 'streaming thoughts here',
      thinkingStartedAt: Date.now() - 5000,
    })
    try {
      expect(text).toMatch(/Thinking for \d+ seconds/)
    } finally {
      cleanup()
    }
  })

  it('shows a generic live indicator when no startedAt is known', async () => {
    const { text, cleanup } = await renderMessageList({
      messages: [],
      thinkingText: 'streaming thoughts without a timestamp',
    })
    try {
      expect(text).toContain('Thinking...')
      expect(text).not.toContain('seconds')
    } finally {
      cleanup()
    }
  })

  it('shows the verbose footer in full mode', async () => {
    const { text, cleanup } = await renderMessageList({
      messages: [],
      fullMode: true,
    })
    try {
      expect(text).toContain('Full mode · ctrl+o to toggle')
      expect(text).toContain('verbose')
    } finally {
      cleanup()
    }
  })

  it('hides the verbose footer outside full mode', async () => {
    const { text, cleanup } = await renderMessageList({ messages: [] })
    try {
      expect(text).not.toContain('Full mode · ctrl+o to toggle')
    } finally {
      cleanup()
    }
  })

  it('advances the live timer as useClock ticks', async () => {
    const { stdout, read, cleanup } = await renderMessageList({
      messages: [],
      thinkingText: 'streaming thoughts here',
      thinkingStartedAt: Date.now() - 5000,
    })
    try {
      const firstSeconds = Number(read().match(/Thinking for (\d+) seconds/)![1]!)
      // The 80ms useClock tick re-renders LiveThinking and rewrites the counter
      // in place (ink partial diff). Force a full redraw after time passes so the
      // last frame carries the updated "Thought for N seconds" text.
      await Bun.sleep(1300)
      invalidateInkFrame(stdout as unknown as NodeJS.WriteStream)
      await Bun.sleep(200)
      const matches = [...read().matchAll(/Thinking for (\d+) seconds/g)]
      const lastSeconds = Number(matches[matches.length - 1]![1]!)
      expect(lastSeconds).toBeGreaterThan(firstSeconds)
    } finally {
      cleanup()
    }
  })
})
