import { expect, test } from 'bun:test'
import { loadItems } from '../src/api.js'

test('loads from /api/items', async () => {
  const urls = []
  const items = await loadItems(async url => { urls.push(String(url)); return Response.json({ items: [{ sku: 'A' }] }) })
  expect(urls).toEqual(['/api/items'])
  expect(items).toEqual([{ sku: 'A' }])
})
