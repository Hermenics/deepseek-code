import { afterEach, expect, it, spyOn } from 'bun:test'
import React from 'react'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import * as os from 'node:os'
import { PassThrough } from 'node:stream'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderSync } from '../../src/ink/root.js'
import { App } from '../../src/ui/App.js'
import { writeIgnoreDefaults } from '../../src/tools/shared/deepseekignore.js'
import { terminalText } from '../helpers/terminalText.js'

class FakeTerminal extends PassThrough {
  isTTY = true
  isRaw = false
  columns = 100
  rows = 30
  setRawMode(enabled: boolean): this { this.isRaw = enabled; return this }
  ref(): this { return this }
  unref(): this { return this }
}

const roots: string[] = []
const servers: ReturnType<typeof Bun.serve>[] = []
let restoreHomedir: (() => void) | undefined
const priorHome = process.env.HOME
const priorUserProfile = process.env.USERPROFILE
let failureSnapshot: () => unknown = () => ({ stage: 'setup' })

async function saveFailure(error: unknown, phase: 'test' | 'cleanup'): Promise<void> {
  const directory = join(process.cwd(), 'test-results')
  const file = join(directory, 'app-session.integration.failure.json')
  try {
    await mkdir(directory, { recursive: true })
    await writeFile(file, JSON.stringify({
      createdAt: new Date().toISOString(), phase, bun: Bun.version, platform: process.platform,
      tty: process.stdout.isTTY === true,
      error: error instanceof Error ? { message: error.message, stack: error.stack } : String(error),
      context: failureSnapshot(),
    }, null, 2))
    console.error(`App approval failure diagnostics: ${file}`)
  } catch (reportError) { console.error('Could not save App approval diagnostics:', reportError) }
}

afterEach(async () => {
  try {
    restoreHomedir?.()
    restoreHomedir = undefined
    for (const server of servers.splice(0)) await server.stop(true)
    for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
  } catch (error) { await saveFailure(error, 'cleanup'); throw error }
  finally {
    if (priorHome === undefined) delete process.env.HOME
    else process.env.HOME = priorHome
    if (priorUserProfile === undefined) delete process.env.USERPROFILE
    else process.env.USERPROFILE = priorUserProfile
  }
})

it('routes interactive App approvals and denials through the Agent', async () => {
  try { await appApprovalSession() }
  catch (error) { await saveFailure(error, 'test'); throw error }
}, 70_000)

async function appApprovalSession() {
  failureSnapshot = () => ({ stage: 'setup' })
  const root = await mkdtemp(join(tmpdir(), 'deepseek-app-approval-'))
  roots.push(root)
  const home = join(root, 'home')
  const project = join(root, 'project')
  const settingsDir = join(home, '.deepseek')
  await Promise.all([mkdir(settingsDir, { recursive: true }), mkdir(project, { recursive: true })])
  process.env.HOME = home
  process.env.USERPROFILE = home
  const homedirSpy = spyOn(os, 'homedir').mockReturnValue(home)
  restoreHomedir = () => homedirSpy.mockRestore()
  writeIgnoreDefaults(project)
  await writeFile(join(settingsDir, 'settings.json'), JSON.stringify({
    promptRefiner: { enabled: false },
    permissions: { allow: ['introspect'], deny: [] },
    risk: { enabled: false },
  }))

  const canaryPath = join(project, 'app-canary.txt')
  const localSourcePath = join(project, 'local-source.txt')
  await writeFile(localSourcePath, 'APP_LOCAL_SOURCE')
  const command = `node -e "require('node:fs').writeFileSync(${JSON.stringify(canaryPath)}, 'APP_CANARY')"`
  let forbiddenFetches = 0
  let rejectedActionResult: unknown
  let localActionResult: unknown
  let forbiddenUrl = ''
  const requestPaths: string[] = []
  let stage = 'deny turn'
  const diagnosticState = () => ({ stage, requestPaths, forbiddenFetches, rejectedActionResult, localActionResult })
  const diagnostics = () => JSON.stringify(diagnosticState())
  let lastScreen = ''
  const readOutput = (stdout: FakeTerminal) => {
    lastScreen = terminalText(stdout as unknown as NodeJS.WriteStream).replace(/\s/g, '')
    return lastScreen
  }
  let currentOutput = () => ({ raw: '', screen: '' })
  failureSnapshot = () => ({ ...diagnosticState(), terminal: currentOutput() })
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: async request => {
      const pathname = new URL(request.url).pathname
      requestPaths.push(pathname)
      if (pathname === '/forbidden') { forbiddenFetches++; return new Response('unexpected fetch') }
      if (pathname !== '/v1/chat/completions') return new Response('not found', { status: 404 })
      const payload = await request.json() as { stream?: boolean; messages?: Array<{ role?: string; content?: unknown }> }
      const sideQuestion = payload.messages?.some(message => message.role === 'user'
        && JSON.stringify(message.content).includes('Suggest one short reply the user could send now.'))
        || payload.messages?.some(message => message.role === 'user'
          && JSON.stringify(message.content).includes('<system-reminder>This is a side question from the user.'))
      // Background extraction must not advance the interactive tool-result scenario.
      if (payload.stream !== true) return Response.json({
        id: 'app-background', object: 'chat.completion', created: 1, model: 'app-approval-test',
        choices: [{ index: 0, message: { role: 'assistant', content: sideQuestion ? 'EMPTY' : '{"kind":"none","fact":""}' }, finish_reason: 'stop' }],
      })
      if (sideQuestion) {
        const chunk = {
          id: 'app-side-question', object: 'chat.completion.chunk', created: 1, model: 'app-approval-test',
          choices: [{ index: 0, delta: { role: 'assistant', content: 'EMPTY' }, finish_reason: 'stop' }],
        }
        return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } })
      }
      const toolResults = payload.messages?.filter(message => message.role === 'tool') ?? []
      const hasToolResult = toolResults.length > 0
      const shouldWrite = JSON.stringify(payload.messages).includes('APP_WRITE')
      const rejectionFlow = JSON.stringify(payload.messages).includes('APP_REJECT_CONTINUE')
      if (rejectionFlow && toolResults.length === 1) rejectedActionResult = toolResults[0]?.content
      if (rejectionFlow && toolResults.length === 2) localActionResult = toolResults[1]?.content
      const nextTool = rejectionFlow
        ? toolResults.length === 0
          ? { id: 'app-rejected-fetch', name: 'web_fetch', args: { url: forbiddenUrl } }
          : toolResults.length === 1
            ? { id: 'app-local-read', name: 'read_file', args: { path: localSourcePath } }
            : undefined
        : !hasToolResult
          ? { id: shouldWrite ? 'app-approved-write' : 'app-denied-shell', name: shouldWrite ? 'write_file' : 'shell', args: shouldWrite ? { path: canaryPath, content: 'APP_CANARY' } : { command } }
          : undefined
      const chunk = nextTool
        ? {
            id: 'app-approval-call', object: 'chat.completion.chunk', created: 1, model: 'app-approval-test',
            choices: [{
              index: 0,
              delta: { role: 'assistant', tool_calls: [{
                index: 0, id: nextTool.id, type: 'function',
                function: { name: nextTool.name, arguments: JSON.stringify(nextTool.args) },
              }] },
              finish_reason: 'tool_calls',
            }],
          }
        : {
            id: 'app-approval-result', object: 'chat.completion.chunk', created: 1, model: 'app-approval-test',
            choices: [{ index: 0, delta: { role: 'assistant', content: 'APP_DONE' }, finish_reason: 'stop' }],
          }
      return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, {
        headers: { 'content-type': 'text/event-stream' },
      })
    },
  })
  servers.push(server)
  forbiddenUrl = `http://127.0.0.1:${server.port}/forbidden`
  stage = 'background memory response'
  const memoryResponse = await fetch(`http://127.0.0.1:${server.port}/v1/chat/completions`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ stream: false, messages: [
      { role: 'user', content: 'APP_REJECT_CONTINUE' },
      { role: 'tool', content: 'background-call-canary' },
    ] }),
  })
  expect(await memoryResponse.json(), diagnostics()).toMatchObject({ choices: [{ message: { content: '{"kind":"none","fact":""}' } }] })
  expect(rejectedActionResult, diagnostics()).toBeUndefined()
  stage = 'deny turn'
  const expectOutputContains = (output: string, expected: string) => {
    expect(output, `Expected UI text: ${expected}; ${diagnostics()}`).toContain(expected)
  }

  const stdin = new FakeTerminal()
  const stdout = new FakeTerminal()
  let rendered = ''
  stdout.on('data', data => { rendered += data.toString() })
  const plainOutput = () => readOutput(stdout)
  currentOutput = () => ({ raw: rendered.slice(-64_000), screen: lastScreen })
  const instance = renderSync(
    <App
      theme="dark"
      providerConfig={{ provider: 'local', localBaseUrl: `http://127.0.0.1:${server.port}/v1`, localModel: 'app-approval-test' }}
      initialSession={{ cwd: project } as never}
      initialMessage="Create the approved file."
      initialSettings={{ interaction: { defaultMode: 'build' }, promptRefiner: { enabled: false } }}
      workspaceTrusted
    />,
    {
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout: stdout as unknown as NodeJS.WriteStream,
      stderr: stdout as unknown as NodeJS.WriteStream,
      exitOnCtrlC: false,
      patchConsole: false,
    },
  )

  try {
    const deadline = Date.now() + 10_000
    while (!plainOutput().includes('Denyandstopthisturn') && Date.now() < deadline) {
      await Bun.sleep(20)
    }
    const prompt = plainOutput()
    expectOutputContains(prompt, 'Confirmation')
    expectOutputContains(prompt, 'Denyandstopthisturn')
    expect(existsSync(canaryPath), diagnostics()).toBe(false)

    await Bun.sleep(50)
    stdin.write('3')
    const deniedDeadline = Date.now() + 5_000
    while (!plainOutput().includes('Executionabortedbyuser.') && Date.now() < deniedDeadline) await Bun.sleep(20)
    expectOutputContains(plainOutput(), 'Executionabortedbyuser.')
    expect(existsSync(canaryPath), diagnostics()).toBe(false)
  } finally {
    stdout.isTTY = false
    instance.unmount()
    instance.cleanup()
    await Bun.sleep(20)
  }

  stage = 'approve write'
  const approvedStdin = new FakeTerminal()
  const approvedStdout = new FakeTerminal()
  let approvedOutput = ''
  approvedStdout.on('data', data => { approvedOutput += data.toString() })
  const approvedPlainOutput = () => readOutput(approvedStdout)
  currentOutput = () => ({ raw: approvedOutput.slice(-64_000), screen: lastScreen })
  const approvedInstance = renderSync(
    <App
      theme="dark"
      providerConfig={{ provider: 'local', localBaseUrl: `http://127.0.0.1:${server.port}/v1`, localModel: 'app-approval-test' }}
      initialSession={{ cwd: project } as never}
      initialMessage="APP_WRITE"
      initialSettings={{ interaction: { defaultMode: 'build' }, promptRefiner: { enabled: false } }}
      workspaceTrusted
    />,
    {
      stdin: approvedStdin as unknown as NodeJS.ReadStream,
      stdout: approvedStdout as unknown as NodeJS.WriteStream,
      stderr: approvedStdout as unknown as NodeJS.WriteStream,
      exitOnCtrlC: false,
      patchConsole: false,
    },
  )
  try {
    const promptDeadline = Date.now() + 10_000
    while (!approvedPlainOutput().includes('Denyandstopthisturn') && Date.now() < promptDeadline) await Bun.sleep(20)
    expectOutputContains(approvedPlainOutput(), 'Confirmation')
    await Bun.sleep(50)
    approvedStdin.write('1')

    const completionDeadline = Date.now() + 10_000
    while (!approvedPlainOutput().includes('APP_DONE') && Date.now() < completionDeadline) await Bun.sleep(20)
    expectOutputContains(approvedPlainOutput(), 'APP_DONE')
    expect(existsSync(canaryPath), diagnostics()).toBe(true)
  } finally {
    approvedStdout.isTTY = false
    approvedInstance.unmount()
    approvedInstance.cleanup()
    await Bun.sleep(20)
  }

  stage = 'reject fetch and continue with local read'
  const rejectionStdin = new FakeTerminal()
  const rejectionStdout = new FakeTerminal()
  let rejectionOutput = ''
  rejectionStdout.on('data', data => { rejectionOutput += data.toString() })
  const rejectionPlainOutput = () => readOutput(rejectionStdout)
  currentOutput = () => ({ raw: rejectionOutput.slice(-64_000), screen: lastScreen })
  const rejectionInstance = renderSync(
    <App
      theme="dark"
      providerConfig={{ provider: 'local', localBaseUrl: `http://127.0.0.1:${server.port}/v1`, localModel: 'app-approval-test' }}
      initialSession={{ cwd: project } as never}
      initialMessage="APP_REJECT_CONTINUE"
      initialSettings={{ interaction: { defaultMode: 'build' }, promptRefiner: { enabled: false } }}
      workspaceTrusted
    />,
    {
      stdin: rejectionStdin as unknown as NodeJS.ReadStream,
      stdout: rejectionStdout as unknown as NodeJS.WriteStream,
      stderr: rejectionStdout as unknown as NodeJS.WriteStream,
      exitOnCtrlC: false,
      patchConsole: false,
    },
  )
  try {
    const remotePromptDeadline = Date.now() + 10_000
    while (!rejectionPlainOutput().includes('Denythisactionandcontinue') && Date.now() < remotePromptDeadline) await Bun.sleep(20)
    expectOutputContains(rejectionPlainOutput(), 'tool:web_fetch')
    expectOutputContains(rejectionPlainOutput(), 'Denythisactionandcontinue')
    await Bun.sleep(50)
    rejectionStdin.write('4')

    const localPromptDeadline = Date.now() + 10_000
    while (!rejectionPlainOutput().includes('tool:read_file') && Date.now() < localPromptDeadline) await Bun.sleep(20)
    expectOutputContains(rejectionPlainOutput(), 'tool:read_file')
    await Bun.sleep(50)
    rejectionStdin.write('1')

    const completionDeadline = Date.now() + 10_000
    while (!rejectionPlainOutput().includes('APP_DONE') && Date.now() < completionDeadline) await Bun.sleep(20)
    expectOutputContains(rejectionPlainOutput(), 'APP_DONE')
    expect(forbiddenFetches, diagnostics()).toBe(0)
    try {
      expect(JSON.parse(String(rejectedActionResult)), diagnostics()).toMatchObject({ error: { kind: 'permission', code: 'USER_DENIED' } })
    } catch (error) { throw new Error(`Invalid rejected-action result: ${diagnostics()}`, { cause: error }) }
    expect(String(localActionResult), diagnostics()).toContain('APP_LOCAL_SOURCE')
  } finally {
    rejectionStdout.isTTY = false
    rejectionInstance.unmount()
    rejectionInstance.cleanup()
    await Bun.sleep(20)
  }
}
