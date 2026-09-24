import { describe, expect, it } from 'bun:test'
import React from 'react'
import { PassThrough } from 'stream'
import { renderSync } from '../../src/ink/root.js'
import instances from '../../src/ink/instances.js'
import { cellAt } from '../../src/ink/screen.js'
import Box from '../../src/ink/components/Box.js'
import ScrollBox from '../../src/ink/components/ScrollBox.js'
import type { ScrollBoxHandle } from '../../src/ink/components/ScrollBox.js'
import Text from '../../src/ink/components/Text.js'
import { MarkdownText } from '../../src/ui/messages/MarkdownText.js'

class FakeTerminal extends PassThrough {
  isTTY = true
  isRaw = false
  columns = 112
  rows = 32
  setRawMode(enabled: boolean): this { this.isRaw = enabled; return this }
}

const paragraph = 'A inteligência artificial pode beneficiar a humanidade ao apoiar a saúde, a educação, a ciência e a acessibilidade. Contudo, também pode ampliar desigualdades, ameaçar a privacidade, reproduzir preconceitos, eliminar empregos e facilitar a circulação de falsidades. A diferença entre esses resultados depende de como a tecnologia é desenvolvida, regulamentada e utilizada. Governos devem criar regras que protejam direitos; empresas precisam agir com transparência; escolas devem preparar os estudantes para um mundo tecnológico; e cidadãos devem participar das discussões sobre essas mudanças.'

describe('fullscreen long transcript resize', () => {
  it('keeps the streaming status after the entire response while width changes', async () => {
    const stdout = new FakeTerminal()
    const stdin = new FakeTerminal()
    stdout.resume()
    const scrollRef = React.createRef<ScrollBoxHandle>()
    const instance = renderSync(
      <Box flexDirection="column" height={32} width="100%">
        <Box height={5}><Text>Header</Text></Box>
        <Box flexDirection="row" flexGrow={1}>
          <ScrollBox ref={scrollRef} stickyScroll flexGrow={1} flexDirection="column" width="100%">
            <Box flexDirection="column">
              <MarkdownText content={Array(6).fill(paragraph).join('\n\n')} />
              <Text>∿ 50s</Text>
            </Box>
          </ScrollBox>
        </Box>
        <Box height={4}><Text>Prompt</Text></Box>
      </Box>,
      { stdout: stdout as unknown as NodeJS.WriteStream, stdin: stdin as unknown as NodeJS.ReadStream, stderr: stdout as unknown as NodeJS.WriteStream, exitOnCtrlC: false, patchConsole: false },
    )
    const ink = instances.get(stdout as unknown as NodeJS.WriteStream)!
    try {
      ink.setAltScreenActive(true)
      ink.onRender()
      const initialHeight = scrollRef.current!.getFreshScrollHeight()
      for (const width of [112, 85, 112, 75, 112]) {
        stdout.columns = width
        stdout.emit('resize')
        await Bun.sleep(100)
        const frame = (ink as unknown as { frontFrame: { screen: Parameters<typeof cellAt>[0] } }).frontFrame
        const lines = Array.from({ length: stdout.rows }, (_, y) =>
          Array.from({ length: width }, (_, x) => cellAt(frame.screen, x, y)?.char ?? ' ').join('').trimEnd(),
        )
        const status = lines.findIndex(line => line.includes('∿ 50s'))
        expect(status).toBeGreaterThan(0)
        expect(lines.slice(5, status).filter(line => line.includes('A inteligência artificial')).length).toBeGreaterThan(1)
        expect(lines.slice(status + 1, -4).every(line => !line.includes('estudantes'))).toBe(true)
        if (width < 112) expect(scrollRef.current!.getFreshScrollHeight()).toBeGreaterThan(initialHeight)
      }
    } finally {
      stdout.isTTY = false
      ink.setAltScreenActive(false)
      instance.unmount()
      instance.cleanup()
    }
  })
})
