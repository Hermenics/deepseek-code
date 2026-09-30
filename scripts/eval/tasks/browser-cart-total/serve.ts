import { randomInt, serveFixture } from '../../browser-fixture.js'

const items = ['Coffee beans', 'Grinder brush', 'Paper filters'].map(name => ({ name, priceCents: randomInt(199, 4999), quantity: randomInt(2, 4) }))
const totalCents = items.reduce((sum, item) => sum + item.priceCents * item.quantity, 0)
await serveFixture({ answer: `$${(totalCents / 100).toFixed(2)}` }, {
  '/api/cart': () => Response.json({ items }),
})
