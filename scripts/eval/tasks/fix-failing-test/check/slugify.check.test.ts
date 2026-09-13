import { expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { slugify } from '../src/slugify'

it('leaves the visible tests untouched', () => {
  expect(readFileSync('test/slugify.test.ts', 'utf8')).toBe(readFileSync('__eval_check__/original-slugify.test.txt', 'utf8'))
})

it('collapses repeated separators', () => {
  expect(slugify('a  --  b')).toBe('a-b')
})

it('returns an empty string when nothing is left', () => {
  expect(slugify('!!!')).toBe('')
})

it('keeps digits and handles accents mid-word', () => {
  expect(slugify('Top 10 Dicas de Programação')).toBe('top-10-dicas-de-programacao')
})
