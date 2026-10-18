import { expect, it } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { updateTarget } from '../src/update.js'

it('updates the nested target and preserves every unrelated field', async () => {
  const source = await readFile(join(import.meta.dir, '../data/config.json'), 'utf8')
  expect(Buffer.byteLength(source)).toBeGreaterThan(1_000_000)
  expect(source).not.toMatch(/[\r\n]/)
  const before = JSON.parse(source)
  const after = JSON.parse(updateTarget(source, 'enabled'))
  const expected = structuredClone(before)
  expected.settings.target.value = 'enabled'
  expect(after).toEqual(expected)
})
