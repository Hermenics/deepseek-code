import { describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildPromptContent, serializeContentForCompaction } from '../src/agent/agent.js'
import { clipboardImageFromBytes } from '../src/utils/platform.js'
import { normalizeDroppedPath, insertDroppedPath } from '../src/ui/input/fileDrop.js'
import { prepareImagePrompt } from '../src/ui/input/imageAttachments.js'

describe('prompt input attachments', () => {
  it('converts supported clipboard bytes to a base64 image', () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const image = clipboardImageFromBytes(bytes)

    expect(image?.mediaType).toBe('image/png')
    expect(Buffer.from(image?.data ?? '', 'base64')).toEqual(Buffer.from(bytes))
    expect(clipboardImageFromBytes(new Uint8Array([1, 2, 3]))).toBeNull()
  })

  it('normalizes direct, shell-escaped, quoted, and file URI drops', () => {
    const root = mkdtempSync(join(tmpdir(), 'deepseek-drop-'))
    const file = join(root, 'screen shot.png')
    writeFileSync(file, 'test')
    try {
      expect(normalizeDroppedPath(file)).toBe(file)
      expect(normalizeDroppedPath(`"${file}"`)).toBe(file)
      expect(normalizeDroppedPath(file.replaceAll(' ', '\\ '))).toBe(file)
      expect(normalizeDroppedPath(pathToFileURL(file).href)).toBe(file)
      expect(normalizeDroppedPath(join(root, 'missing.png'))).toBeNull()
      expect(insertDroppedPath('see', 3, file).text).toBe(`see ${file}`)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('keeps only surviving image placeholders and remaps their indexes', () => {
    const images = [
      { mediaType: 'image/png' as const, data: 'first' },
      { mediaType: 'image/jpeg' as const, data: 'second' },
    ]
    expect(prepareImagePrompt('[Image #2] / [Image #1] / [Image #2]', images)).toEqual({
      text: '[Image #1] / [Image #2] / [Image #1]',
      images: [images[1], images[0]],
    })
    expect(prepareImagePrompt('text only', images)).toEqual({ text: 'text only', images: [] })
  })

  it('builds the OpenAI-compatible text and data URL image parts', () => {
    expect(buildPromptContent('look at [Image #1]', [{ mediaType: 'image/png', data: 'abc' }])).toEqual([
      { type: 'text', text: 'look at' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,abc', detail: 'auto' } },
    ])
  })

  it('serializes multimodal and tool-call content for compaction without base64 data', () => {
    const content = buildPromptContent('look at [Image #1]', [{ mediaType: 'image/png', data: 'SECRETBASE64' }])
    const serialized = serializeContentForCompaction(content)
    expect(serialized).toBe('look at\n[Image: image/png]')
    expect(serialized).not.toContain('SECRETBASE64')
    expect(serializeContentForCompaction(null)).toBe('')
    expect(serializeContentForCompaction('plain')).toBe('plain')
  })
})
