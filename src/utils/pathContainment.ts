import { isAbsolute, sep } from 'node:path'

/**
 * True when a `path.relative(root, target)` result points outside `root`: an absolute path, `..`
 * itself, or a leading `..` path segment. A name that merely starts with `..` (such as `..notes.md`)
 * is inside, which a bare `startsWith('..')` check gets wrong.
 */
export function escapesRoot(relativePath: string): boolean {
  return relativePath === '..'
    || relativePath.startsWith(`..${sep}`)
    || relativePath.startsWith('../')
    || isAbsolute(relativePath)
}
