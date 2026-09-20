/**
 * Settings rows put the label on the left and the value on the right with
 * `space-between`. When the two happen to fill the row exactly there is no
 * separator left and they read as one word — the reported case was a model
 * name welded onto the end of "Legacy default model".
 *
 * A margin does not survive this. The layout engine drops margins and
 * padding once a row runs out of room — exactly the case that needs the
 * separator — while characters in the string cannot be dropped, and
 * truncation eats the end, so two leading blanks always live through it.
 */
import { describe, expect, it } from 'bun:test'
import React from 'react'
import { PassThrough } from 'stream'
import { renderSync } from '../../src/ink/root.js'
import Box from '../../src/ink/components/Box.js'
import Text from '../../src/ink/components/Text.js'

class FakeTerminal extends PassThrough {
  isTTY = true
  isRaw = false
  constructor(public columns = 30, public rows = 4) { super() }
  setRawMode(enabled: boolean): this { this.isRaw = enabled; return this }
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0))

const ESC = String.fromCharCode(27)
/** Runs of spaces are emitted as cursor-forward, not as literal blanks. */
const CURSOR_FORWARD = new RegExp(ESC + '\\[([0-9]+)C', 'g')
const ANSI = new RegExp(ESC + '\\[[0-9;?]*[A-Za-z]', 'g')

/**
 * What the terminal would actually paint. Stripping escapes alone is not
 * enough here: the renderer turns gaps into cursor movement, so a test that
 * only removed escapes would erase the very spacing it is checking and
 * report a gap as missing.
 */
function paint(raw: string): string {
  return raw
    .replace(CURSOR_FORWARD, (_, count: string) => ' '.repeat(Number(count)))
    .replace(ANSI, '')
}

async function renderRow(label: string, value: string, columns: number): Promise<string> {
  const stdout = new FakeTerminal(columns)
  const stdin = new FakeTerminal(columns)
  const chunks: string[] = []
  stdout.on('data', chunk => chunks.push(String(chunk)))

  const instance = renderSync(
    <Box width="100%" justifyContent="space-between">
      <Text wrap="truncate-end" flexShrink={1}>{label}</Text>
      <Text wrap="truncate-end" flexShrink={0}>{`  ${value}`}</Text>
    </Box>,
    {
      stdout: stdout as unknown as NodeJS.WriteStream,
      stdin: stdin as unknown as NodeJS.ReadStream,
      stderr: stdout as unknown as NodeJS.WriteStream,
      exitOnCtrlC: false,
      patchConsole: false,
    },
  )
  try {
    await flush()
    return paint(chunks.join(''))
  } finally {
    instance.unmount()
  }
}

describe('settings row gutter', () => {
  it('keeps label and value apart when they would exactly fill the row', async () => {
    // 'Legacy default model' and 'deepseek-flash' are 34 characters together
    // in a 36 column row — the margin is what stops them from meeting.
    const output = await renderRow('Legacy default model', 'deepseek-flash', 36)
    expect(output).toContain('Legacy default model  deepseek-flash')
  })

  it('truncates the label rather than giving up the gutter', async () => {
    // A margin loses here: at this width the engine spends it on content
    // and the two columns end up welded together.
    const output = await renderRow('An extremely long setting label', 'value', 20)
    // Both sides are cut short, but never into each other.
    expect(output).toMatch(/\S {2,}\S/)
  })

  it('leaves a roomy row alone', async () => {
    const output = await renderRow('Short', 'ok', 40)
    expect(output).toContain('Short')
    expect(output).toContain('ok')
    // space-between still pushes the value to the far edge.
    expect(output).toMatch(/Short {2,}ok\r?\n/)
  })
})
