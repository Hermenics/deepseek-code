import { randomInt, serveFixture } from '../../browser-fixture.js'

const options = [
  { id: 'standard', label: 'Standard', days: randomInt(4, 7) },
  { id: 'express', label: 'Express', days: randomInt(1, 3) },
]
const reference = `SHIP-${randomInt(100000, 999999)}`
await serveFixture({ answer: reference }, { '/api/quote': () => Response.json({ options, reference }) })
