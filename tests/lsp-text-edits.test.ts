import { expect, it } from 'bun:test'
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { applyTextEdits, readTextDocument } from '../src/tools/shared/textEdits.js'
import { EditFile } from '../src/tools/EditFile/EditFile.js'
import { validateToolArguments } from '../src/orchestration/schema.js'
const hash = (text: string) => createHash('sha256').update(text).digest('hex')
const edit = (line: number, start: number, end: number, newText: string) => ({ range: { start: { line, character: start }, end: { line, character: end } }, newText })

it('applies simultaneous UTF-16 edits and preserves BOM, CRLF and the final newline state', () => {
  const source = '\ufeffconst emoji = "😀";\r\nconst value = emoji;'
  const result = applyTextEdits(source, [edit(0, 7, 12, 'symbol'), edit(1, 14, 19, 'symbol')])
  expect(result.content).toBe('\ufeffconst symbol = "😀";\r\nconst value = symbol;')
  expect(result.preview[0].before).toBe('emoji')
  const inserted = applyTextEdits('one\r\ntwo', [edit(1, 0, 0, 'first\n')])
  expect(inserted.content).toBe('one\r\nfirst\r\ntwo')
  expect(inserted.lineEndingNormalization).toBe('CRLF')
})

it('preserves insertion order and rejects overlap, invalid coordinates and surrogate splits', () => {
  expect(applyTextEdits('abc', [edit(0, 0, 0, 'A'), edit(0, 0, 0, 'B'), edit(0, 0, 1, 'C')]).content).toBe('ABCbc')
  expect(() => applyTextEdits('abc', [edit(0, 0, 2, 'a'), edit(0, 1, 3, 'b')])).toThrow('overlap')
  expect(() => applyTextEdits('abc', [edit(0, 5, 6, '')])).toThrow('range')
  expect(() => applyTextEdits('😀', [edit(0, 1, 2, 'x')])).toThrow('surrogate')
  expect(() => applyTextEdits('abc', [edit(0, 0, 1, '\ud800')])).toThrow('UTF-8')
})

it('accepts only one edit mode and requires an explicit base hash for range edits', () => {
  const range = { path: 'file.ts', expected_hash: hash('abc'), text_edits: [edit(0, 0, 1, 'A')] }
  expect(validateToolArguments(EditFile.parameters, range).valid).toBe(true)
  expect(validateToolArguments(EditFile.parameters, { ...range, edits: [] }).valid).toBe(false)
  expect(validateToolArguments(EditFile.parameters, { ...range, expected_hash: undefined }).valid).toBe(false)
  expect(validateToolArguments(EditFile.parameters, { path: 'file.ts', edits: [], expected_hash: hash('abc') }).valid).toBe(false)
})

it('applies a range proposal through the existing file writer and refuses stale base/read versions', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'deepseek-lsp-edit-')))
  const path = join(root, 'file.ts'); const source = 'const value = 1\r\n'
  const context = { sessionId: 'range-edit', workspacePath: root, projectRoot: root, permissionProfile: 'coordinator-integrator' as const }
  const args = { path, expected_hash: hash(source), text_edits: [edit(0, 6, 11, 'renamed')] }
  try {
    await writeFile(path, source)
    await expect(EditFile.execute({ path, expected_hash: hash(source), edits: [] }, context)).rejects.toThrow('requires text_edits')
    const result = JSON.parse(await EditFile.execute(args, context))
    expect(result.baseHash).toBe(hash(source))
    expect(await readFile(path, 'utf8')).toBe('const renamed = 1\r\n')
    await expect(EditFile.execute(args, context)).rejects.toThrow('changed')
    await writeFile(path, source)
    await expect(EditFile.execute(args, { ...context, expectedFileVersion: { exists: true, hash: hash('earlier read') } })).rejects.toThrow('read')
    expect(await readFile(path, 'utf8')).toBe(source)
    const controller = new AbortController(); controller.abort(new Error('Stop range edit'))
    await expect(EditFile.execute(args, { ...context, signal: controller.signal })).rejects.toThrow('Stop range edit')
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('keeps the BOM in read snapshots and applied range edits', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'deepseek-lsp-bom-')))
  const path = join(root, 'file.ts'); const source = '\ufeffconst value = 1'
  const context = { sessionId: 'bom-edit', workspacePath: root, projectRoot: root, permissionProfile: 'coordinator-integrator' as const }
  try {
    await writeFile(path, source)
    const snapshot = await readTextDocument(path, context)
    expect(snapshot.text).toBe(source)
    expect(snapshot.hash).toBe(hash(source))
    await EditFile.execute({ path, expected_hash: snapshot.hash, text_edits: [edit(0, 7, 12, 'renamed')] }, context)
    expect(await readFile(path, 'utf8')).toBe('\ufeffconst renamed = 1')
  } finally { await rm(root, { recursive: true, force: true }) }
})
