import { expect, test } from 'bun:test'
import { loadItems } from '../src/api.js'

test('throws on HTTP errors', async () => {
  await expect(loadItems(async () => new Response('', { status: 500 }))).rejects.toThrow('HTTP 500')
})
