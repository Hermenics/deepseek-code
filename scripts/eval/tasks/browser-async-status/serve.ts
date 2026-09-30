import { randomInt, serveFixture } from '../../browser-fixture.js'

const job = { status: 'complete', reference: `JOB-${randomInt(100000, 999999)}` }
await serveFixture({ answer: job.reference }, {
  '/api/job': async () => {
    await Bun.sleep(350)
    return Response.json(job)
  },
})
