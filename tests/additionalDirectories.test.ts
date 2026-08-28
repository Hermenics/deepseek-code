import { describe, expect, it, afterEach } from 'bun:test'
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { AdditionalDirectories } from '../src/agent/additionalDirectories.js'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function tempRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix))
  temporaryRoots.push(root)
  return root
}

describe('AdditionalDirectories', () => {
  it('adds canonical existing directories, deduplicates, and returns a snapshot', async () => {
    const workspace = await tempRoot('dsk-add-dir-workspace-')
    const external = await tempRoot('dsk-add-dir-external-')
    const roots = new AdditionalDirectories(workspace)

    expect(await roots.add(external)).toBe(await realpath(external))
    expect(await roots.add(path.join(external, '.'))).toEqual(await realpath(external))
    const listed = roots.list()
    listed.push('/not-approved')

    expect(roots.list()).toEqual([await realpath(external)])
  })

  it('keeps approvals scoped to the instance and removes one root only', async () => {
    const workspace = await tempRoot('dsk-add-dir-workspace-')
    const first = await tempRoot('dsk-add-dir-first-')
    const second = await tempRoot('dsk-add-dir-second-')
    const roots = new AdditionalDirectories(workspace)
    const otherSession = new AdditionalDirectories(workspace)

    await roots.add(first)
    await roots.add(second)
    expect(await roots.remove(first)).toBe(await realpath(first))
    expect(await roots.remove(first)).toBeUndefined()
    expect(roots.list()).toEqual([await realpath(second)])
    expect(otherSession.list()).toEqual([])
  })

  it('stores the real target of a symlink and rejects files and missing paths', async () => {
    const workspace = await tempRoot('dsk-add-dir-workspace-')
    const external = await tempRoot('dsk-add-dir-external-')
    const link = path.join(workspace, 'linked')
    await symlink(external, link)
    const roots = new AdditionalDirectories(workspace)

    expect(await roots.add(link)).toBe(await realpath(external))
    await writeFile(path.join(workspace, 'file.txt'), 'x')
    await expect(roots.add(path.join(workspace, 'file.txt'))).rejects.toThrow('not a directory')
    await expect(roots.add(path.join(workspace, 'missing'))).rejects.toThrow('does not exist')
  })

  it('rejects traversal, blocked roots, and sensitive roots', async () => {
    const workspace = await tempRoot('dsk-add-dir-workspace-')
    const outside = await tempRoot('dsk-add-dir-outside-')
    await mkdir(path.join(workspace, '.git'))
    await mkdir(path.join(workspace, '.env'))
    const roots = new AdditionalDirectories(workspace)

    await expect(roots.add(path.join('..', path.basename(outside)))).rejects.toThrow('traversal')
    await expect(roots.add(path.join(workspace, '.git'))).rejects.toThrow('off-limits')
    await expect(roots.add(path.join(workspace, '.env'))).rejects.toThrow('sensitive')
  })
})
