import { describe, expect, it } from 'bun:test'
import React, { createRef } from 'react'
import { PassThrough } from 'stream'
import type { FrameEvent } from '../../src/ink/frame.js'
import { renderSync } from '../../src/ink/root.js'
import Box from '../../src/ink/components/Box.js'
import ScrollBox, { type ScrollBoxHandle } from '../../src/ink/components/ScrollBox.js'
import Text from '../../src/ink/components/Text.js'

class FakeTerminal extends PassThrough {
  isTTY = true
  isRaw = false

  constructor(
    public columns = 16,
    public rows = 5,
  ) {
    super()
  }

  setRawMode(enabled: boolean): this {
    this.isRaw = enabled
    return this
  }
}

const waitForRenderer = () => new Promise(resolve => setTimeout(resolve, 0))

describe('Ink terminal contract', () => {
  it('writes Unicode, reflows on resize, and exposes imperative scroll', async () => {
    const stdout = new FakeTerminal()
    const stdin = new FakeTerminal()
    const frames: FrameEvent[] = []
    const chunks: string[] = []
    const scrollRef = createRef<ScrollBoxHandle>()
    stdout.on('data', chunk => chunks.push(String(chunk)))

    const instance = renderSync(
      <Box flexDirection="column" height={5}>
        <Text>漢字 é 👩‍💻</Text>
        <ScrollBox ref={scrollRef} height={3} flexDirection="column">
          {Array.from({ length: 8 }, (_, index) => <Text key={index}>line {index}</Text>)}
        </ScrollBox>
      </Box>,
      {
        stdout: stdout as unknown as NodeJS.WriteStream,
        stdin: stdin as unknown as NodeJS.ReadStream,
        stderr: stdout as unknown as NodeJS.WriteStream,
        exitOnCtrlC: false,
        patchConsole: false,
        onFrame: frame => frames.push(frame),
      },
    )

    try {
      await waitForRenderer()
      expect(chunks.join('')).toContain('漢')
      expect(scrollRef.current).not.toBeNull()

      scrollRef.current!.scrollBy(3)
      expect(scrollRef.current!.getPendingDelta()).toBe(3)

      stdout.columns = 10
      stdout.rows = 4
      stdout.emit('resize')
      await waitForRenderer()

      expect(frames.some(frame => frame.flickers.some(flicker => flicker.reason === 'resize'))).toBe(true)
      expect(scrollRef.current!.getScrollTop()).toBeGreaterThan(0)
    } finally {
      // Avoid the real fd-1 cleanup write: this terminal exists only in memory.
      stdout.isTTY = false
      instance.unmount()
      instance.cleanup()
    }
  })
})
