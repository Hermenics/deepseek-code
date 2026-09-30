import { randomInt, serveFixture } from '../../browser-fixture.js'

const count = randomInt(37, 89)
const items = Array.from({ length: count }, (_, i) => ({ sku: `SKU-${1000 + i}`, name: `Part ${i + 1}` }))
await serveFixture({ answer: String(count) }, {
  '/api/items': () => Response.json({ items }),
})
