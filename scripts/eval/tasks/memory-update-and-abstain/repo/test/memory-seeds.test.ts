import { expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

it('keeps the historical and updated project notes available', () => {
  expect(readFileSync('memory/sessions/01-port.md', 'utf8')).toContain('port 3000')
  expect(readFileSync('memory/sessions/02-port-move.md', 'utf8')).toContain('port 4100')
})

it('keeps the unrelated project fact scoped to its own note', () => {
  const otherProject = readFileSync('memory/other-projects/paperkite.md', 'utf8')
  expect(otherProject).toContain('paperkite')
  expect(otherProject).toContain('port 4800')
})
