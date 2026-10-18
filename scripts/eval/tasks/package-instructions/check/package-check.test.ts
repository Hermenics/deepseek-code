import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { formatId } from '../repo/packages/api/src/formatId'

test('API identifier semantics obey the nested contract', () => {
  expect(formatId('00123456')).toBe('00123456')
  expect(() => formatId('1234567')).toThrow()
  expect(() => formatId('123456789')).toThrow()
  expect(() => formatId('１２３４５６７８')).toThrow()
})

test('unrelated package bytes remain unchanged', () => {
  const webFile = join(import.meta.dir, '../repo/packages/web/src/format.ts')
  expect(readFileSync(webFile, 'utf8')).toContain('Intl.NumberFormat')
})
