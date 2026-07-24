import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { getAtMention, searchFiles } from '../src/ui/input/fileMatcher.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('fileMatcher', () => {
  it('returns the full mention bounds when the cursor is in the middle of a path', () => {
    const input = 'inspect @src/file.ts now'
    const mention = getAtMention(input, input.indexOf('/file'))

    expect(mention).not.toBeNull()
    expect(mention!.query).toBe('src')
    expect(input.slice(mention!.atStart, mention!.atEnd)).toBe('@src/file.ts')
  })

  it('stops recognizing the mention once its @ prefix is removed', () => {
    expect(getAtMention('src/file.ts', 0)).toBeNull()
  })

  it('treats glob characters in the query as literal text', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'dsk-file-matcher-'))
    temporaryDirectories.push(cwd)
    await writeFile(join(cwd, 'special[query].ts'), '')

    expect(await searchFiles('[query]', cwd)).toEqual(['special[query].ts'])
  })

  it('uses subsequence matching only when fuzzy search is enabled', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'dsk-file-matcher-'))
    temporaryDirectories.push(cwd)
    await writeFile(join(cwd, 'special-query.ts'), '')

    expect(await searchFiles('spq', cwd, 8, true)).toEqual(['special-query.ts'])
    expect(await searchFiles('spq', cwd, 8, false)).toEqual([])
  })
})
