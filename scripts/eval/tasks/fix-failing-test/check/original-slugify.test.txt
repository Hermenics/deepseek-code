import { expect, it } from 'bun:test'
import { slugify } from '../src/slugify'

it('joins words with dashes', () => {
  expect(slugify('Hello World')).toBe('hello-world')
})

it('trims separators at both ends', () => {
  expect(slugify('  --Hello, World!-- ')).toBe('hello-world')
})

it('strips accents', () => {
  expect(slugify('Ação Rápida')).toBe('acao-rapida')
})
