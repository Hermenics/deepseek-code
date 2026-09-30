import { randomInt, serveFixture } from '../../browser-fixture.js'

const email = `ana+team${randomInt(100, 999)}@example.com`
const code = `CONF-${randomInt(10000, 99999)}`
await serveFixture({ email, answer: code }, {
  'POST /api/signup': async request => {
    const body = await request.json().catch(() => ({})) as { email?: string }
    return body.email === email ? Response.json({ code }) : Response.json({ error: 'unknown email' }, { status: 400 })
  },
})
