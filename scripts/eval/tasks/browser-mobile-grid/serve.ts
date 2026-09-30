import { randomInt, serveFixture } from '../../browser-fixture.js'

const reference = `CARD-${randomInt(10000, 99999)}`
await serveFixture({ answer: reference }, { '/api/card': () => Response.json({ title: 'Release checklist', reference }) })
