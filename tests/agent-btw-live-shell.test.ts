import { expect, it } from 'bun:test'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Agent } from '../src/agent/agent.js'
import { sandboxAvailable } from '../src/utils/platform.js'
import { getImmediateBtwQuestion } from '../src/ui/queueLogic.js'

async function waitForFile(path: string) {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    try { await access(path); return } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    await Bun.sleep(10)
  }
  throw new Error(`Fixture did not reach barrier: ${path}`)
}

for (const cancelSideQuestion of [false, true]) {
  it.skipIf(!sandboxAvailable())(`keeps a foreground shell alive when a side question ${cancelSideQuestion ? 'is cancelled' : 'answers'}`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-btw-live-'))
    const agent = new Agent({ provider: 'local', localBaseUrl: 'http://127.0.0.1:65535/v1', localModel: 'fixture' }, { projectRoot: root, logFile: null, snapshotFile: null })
    const previousHistoryPath = process.env.DEEPSEEK_HISTORY_PATH
    process.env.DEEPSEEK_HISTORY_PATH = join(root, 'fixture-history.json')
    let pending: Promise<void> | undefined
    let completed = false
    let mainCalls = 0
    let sideCalls = 0
    let toolCalls = 0
    const results: string[] = []
    let mainSignal: AbortSignal | undefined
    try {
      await writeFile(join(root, 'job.ts'), `
import { appendFileSync, existsSync, writeFileSync } from 'node:fs'
appendFileSync('runs.txt', 'started\\n')
writeFileSync('ready', '')
while (!existsSync('release')) {
  if (existsSync('probe')) writeFileSync('ack', '')
  await Bun.sleep(10)
}
appendFileSync('runs.txt', 'finished\\n')
console.log('Fixture job completed')
`)
      await agent.readyPromise
      const internal = agent as any
      internal.settings = { memory: { enabled: false }, risk: { enabled: false }, permissions: { allow: ['shell'] } }
      let sideStarted!: () => void
      const sideReady = new Promise<void>(resolve => { sideStarted = resolve })
      internal.client = { chat: { completions: { create: async (request: any, options: { signal: AbortSignal }) => {
        if (!request.stream) {
          sideCalls++
          expect(request.tools).toBeUndefined()
          expect(options.signal).not.toBe(mainSignal)
          expect(request.messages.some((message: any) => message.tool_calls?.length)).toBe(false)
          sideStarted()
          if (cancelSideQuestion) return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(new Error('Side question cancelled')), { once: true }))
          return { choices: [{ message: { content: 'The job is still running.' } }] }
        }
        mainCalls++
        mainSignal ??= options.signal
        const delta = mainCalls === 1
          ? { tool_calls: [{ index: 0, id: 'live-job', type: 'function', function: { name: 'shell', arguments: JSON.stringify({ command: 'bun job.ts', timeout: 15 }) } }] }
          : { content: 'The fixture job finished.' }
        return (async function* () { yield { choices: [{ delta, finish_reason: mainCalls === 1 ? 'tool_calls' : 'stop' }] } })()
      } } } }
      pending = agent.run('Run bun job.ts once and wait for it to finish.', {
        onToken() {}, onToolCall() { toolCalls++ }, onToolResult(_name, result) { results.push(String(result)) }, onDone() { completed = true },
      })
      await waitForFile(join(root, 'ready'))
      expect(completed).toBe(false)
      const controller = new AbortController()
      const question = getImmediateBtwQuestion('/btw What is the job status?')!
      const side = agent.askBtw(question, controller.signal)
      if (cancelSideQuestion) {
        await sideReady
        controller.abort()
        await expect(side).rejects.toThrow('Side question cancelled')
      } else await expect(side).resolves.toBe('The job is still running.')
      expect(mainSignal?.aborted).toBe(false)
      expect(completed).toBe(false)
      expect(mainCalls).toBe(1)
      await writeFile(join(root, 'probe'), '')
      await waitForFile(join(root, 'ack'))
      expect(await readFile(join(root, 'runs.txt'), 'utf8')).toBe('started\n')
      await writeFile(join(root, 'release'), '')
      await pending
      expect(completed).toBe(true)
      expect(mainCalls).toBe(2)
      expect(sideCalls).toBe(1)
      expect(toolCalls).toBe(1)
      expect(results).toHaveLength(1)
      expect(results[0]).toContain('Fixture job completed')
      expect(await readFile(join(root, 'runs.txt'), 'utf8')).toBe('started\nfinished\n')
    } finally {
      agent.abort()
      await pending?.catch(() => undefined)
      await agent.shutdown()
      if (previousHistoryPath === undefined) delete process.env.DEEPSEEK_HISTORY_PATH
      else process.env.DEEPSEEK_HISTORY_PATH = previousHistoryPath
      await rm(root, { recursive: true, force: true })
    }
  }, 15_000)
}
