import { randomInt, serveFixture } from '../../browser-fixture.js'

const team = `blue-${randomInt(100, 999)}`
const token = `TKN-${randomInt(100000, 999999)}`
const session = crypto.randomUUID()
await serveFixture({ team, answer: token }, {
  'POST /api/login': async request => {
    const body = await request.json().catch(() => ({})) as { team?: string }
    if (body.team !== team) return Response.json({ error: 'unknown team' }, { status: 401 })
    return Response.json({ ok: true }, { headers: { 'set-cookie': `session=${session}; Path=/; HttpOnly` } })
  },
  '/api/dashboard': request => request.headers.get('cookie')?.includes(`session=${session}`)
    ? Response.json({ token })
    : Response.json({ error: 'not logged in' }, { status: 401 }),
})
