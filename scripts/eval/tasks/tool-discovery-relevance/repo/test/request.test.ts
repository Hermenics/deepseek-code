import { expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'

test('the task identifies an invoice but leaves the target currency unspecified', async () => {
  const request = JSON.parse(await readFile('request.json', 'utf8')) as { invoice_id: string; target_currency: string | null }
  expect(request.invoice_id).toBe('INV-1048')
  expect(request.target_currency).toBeNull()
})
