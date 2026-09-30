import { randomInt, serveFixture } from '../../browser-fixture.js'

const scores = [randomInt(5, 9), randomInt(10, 49), randomInt(100, 199), randomInt(50, 99)]
const rows = scores.map((score, i) => ({ ref: `T-${randomInt(1000, 9999)}-${i}`, score }))
const answer = [...rows].sort((a, b) => a.score - b.score)[0]!.ref
await serveFixture({ answer }, { '/api/queue': () => Response.json({ rows }) })
