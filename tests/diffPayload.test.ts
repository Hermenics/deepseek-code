import { describe, expect, it } from 'bun:test'
import { getDiffPayload } from '../src/ui/messages/MessageList.js'

describe('getDiffPayload', () => {
  it('recognizes write and patch tool diffs without accepting malformed tool output', () => {
    const diff = { __diff: true, path: 'src/a.ts', added: 2, removed: 1, firstChanged: 4, lines: [] }

    expect(getDiffPayload(`✓ write_file → ${JSON.stringify(diff)}`)).toMatchObject(diff)
    expect(getDiffPayload(`✓ patch_file → ${JSON.stringify(diff)}`)).toMatchObject(diff)
    expect(getDiffPayload('✓ write_file → not json')).toBeNull()
    expect(getDiffPayload('✓ grep → {}')).toBeNull()
  })

  it('rejects JSON payloads with malformed counters or diff lines', () => {
    const valid = { __diff: true, path: 'src/a.ts', added: 2, removed: 1, firstChanged: 4, lines: [{ type: 'added', text: '+ok', lineNo: 4 }] }
    const malformed = [
      { ...valid, added: '2' },
      { ...valid, removed: null },
      { ...valid, firstChanged: false },
      { ...valid, lines: [{ type: 'changed', text: '+ok', lineNo: 4 }] },
      { ...valid, lines: [{ type: 'added', text: 1, lineNo: 4 }] },
      { ...valid, lines: [{ type: 'added', text: '+ok', lineNo: '4' }] },
    ]

    for (const diff of malformed) {
      expect(getDiffPayload(`✓ write_file → ${JSON.stringify(diff)}`)).toBeNull()
    }
  })
})
