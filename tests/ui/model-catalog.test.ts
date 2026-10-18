import { expect, test } from 'bun:test'
import { loadModelCatalog } from '../../src/ui/App.js'

test('model catalog failures stay distinct from an empty catalog and clear loading', async () => {
  const loading: boolean[] = []
  const result = await loadModelCatalog(async () => {
    throw new Error('provider unavailable')
  }, value => loading.push(value))

  expect(result).toEqual({ error: 'provider unavailable' })
  expect(loading).toEqual([true, false])
})

test('a successful empty catalog remains an empty model list and clears loading', async () => {
  const loading: boolean[] = []
  const result = await loadModelCatalog(async () => [], value => loading.push(value))

  expect(result).toEqual({ models: [] })
  expect(loading).toEqual([true, false])
})
