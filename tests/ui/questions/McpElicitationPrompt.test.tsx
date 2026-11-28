import { expect, test } from 'bun:test'
import React, { Activity } from 'react'
import { PassThrough } from 'node:stream'
import { EventEmitter } from '../../../src/ink/events/emitter.js'
import { InputEvent } from '../../../src/ink/events/input-event.js'
import { renderSync } from '../../../src/ink/root.js'
import { terminalText } from '../../helpers/terminalText.js'
import Text from '../../../src/ink/components/Text.js'
import {
  bindMcpElicitationInput,
  bindMcpElicitationPrompt,
  McpElicitationPrompt,
  type McpElicitationInputHandler,
  type McpElicitationPromptState,
} from '../../../src/ui/questions/McpElicitationPrompt.js'
import type { McpElicitationHandler, McpElicitationRequest, McpElicitationResponse, McpElicitationSchema } from '../../../src/agent/mcpElicitation.js'

class FakeTerminal extends PassThrough {
  isTTY = true
  isRaw = false
  columns = 100
  rows = 30
  setRawMode(enabled: boolean): this { this.isRaw = enabled; return this }
  ref(): this { return this }
  unref(): this { return this }
}

const formSchema: McpElicitationSchema = {
  type: 'object',
  properties: {
    name: { type: 'string', title: 'Name', default: 'Ada' },
    age: { type: 'integer', minimum: 18, maximum: 99, default: 42 },
    score: { type: 'number', minimum: 0, maximum: 10, default: 7.5 },
    enabled: { type: 'boolean', default: true },
    color: { type: 'string', enum: ['blue', 'green'], enumNames: ['Blue', 'Green'], default: 'blue' },
    mode: { type: 'string', oneOf: [{ const: 'safe', title: 'Safe mode' }, { const: 'fast', title: 'Fast mode' }], default: 'safe' },
    features: { type: 'array', items: { type: 'string', enum: ['search', 'preview'] }, minItems: 1, maxItems: 2, default: ['search'] },
  },
  required: ['name', 'age', 'enabled', 'color', 'mode', 'features'],
}

const request: McpElicitationRequest = {
  serverName: 'profile-store',
  message: 'Choose the values to save.',
  requestedSchema: formSchema,
}

function renderPrompt(props: Partial<React.ComponentProps<typeof McpElicitationPrompt>> = {}) {
  const stdin = new FakeTerminal()
  const stdout = new FakeTerminal()
  const instance = renderSync(
    <McpElicitationPrompt request={request} onAccept={() => {}} onDecline={() => {}} onCancel={() => {}} {...props} />,
    {
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout: stdout as unknown as NodeJS.WriteStream,
      stderr: stdout as unknown as NodeJS.WriteStream,
      exitOnCtrlC: false,
      patchConsole: false,
    },
  )
  let rendered = ''
  stdout.on('data', chunk => { rendered += chunk.toString() })
  return { stdin, stdout, instance, rendered: () => rendered }
}

async function press(stdin: FakeTerminal, input: string) {
  stdin.write(input)
  await Bun.sleep(40)
}

function plain(value: string) {
  return value.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '').replace(/\s/g, '')
}

function cleanup(prompt: ReturnType<typeof renderPrompt>) {
  prompt.stdout.isTTY = false
  prompt.instance.unmount()
  prompt.instance.cleanup()
}

let coveredScreenMounts = 0

function StatefulCoveredScreen() {
  const [draft] = React.useState(() => ++coveredScreenMounts)
  return <Text>Screen draft: {draft}</Text>
}

function ActivityScreen({ hidden }: { hidden: boolean }) {
  return <Activity mode={hidden ? 'hidden' : 'visible'}><StatefulCoveredScreen /></Activity>
}

const enumRequest: McpElicitationRequest = {
  serverName: 'profile-store',
  message: 'Choose a color.',
  requestedSchema: { type: 'object', properties: { color: { type: 'string', enum: ['blue', 'green'], default: 'blue' } } },
}

function ActivityMcpForm({ hidden }: { hidden: boolean }) {
  return (
    <>
      <Activity mode={hidden ? 'hidden' : 'visible'}>
        <McpElicitationPrompt request={enumRequest} active={!hidden} onAccept={() => {}} onDecline={() => {}} onCancel={() => {}} />
      </Activity>
      {hidden && <Text>Higher priority prompt</Text>}
    </>
  )
}

test('keeps a covered screen mounted while the MCP form takes priority', async () => {
  coveredScreenMounts = 0
  const stdin = new FakeTerminal()
  const stdout = new FakeTerminal()
  const output = stdout as unknown as NodeJS.WriteStream
  const instance = renderSync(<ActivityScreen hidden={false} />, {
    stdin: stdin as unknown as NodeJS.ReadStream,
    stdout: output,
    stderr: output,
    exitOnCtrlC: false,
    patchConsole: false,
  })
  try {
    await Bun.sleep(60)
    await press(stdin, 'x')
    expect(coveredScreenMounts).toBe(1)
    instance.rerender(<ActivityScreen hidden />)
    await Bun.sleep(60)
    expect(coveredScreenMounts).toBe(1)
    expect(terminalText(output)).not.toContain('Screen draft: 1')
    instance.rerender(<ActivityScreen hidden={false} />)
    await Bun.sleep(60)
    expect(coveredScreenMounts).toBe(1)
    expect(terminalText(output)).toContain('Screen draft: 1')
  } finally {
    stdout.isTTY = false
    instance.unmount()
    instance.cleanup()
  }
})

test('keeps an MCP form draft while covered and ignores input until visible again', async () => {
  const stdin = new FakeTerminal()
  const stdout = new FakeTerminal()
  const output = stdout as unknown as NodeJS.WriteStream
  const instance = renderSync(<ActivityMcpForm hidden={false} />, {
    stdin: stdin as unknown as NodeJS.ReadStream,
    stdout: output,
    stderr: output,
    exitOnCtrlC: false,
    patchConsole: false,
  })
  try {
    await Bun.sleep(60)
    await press(stdin, '\x1b[C')
    expect(terminalText(output)).toContain('green ✓')

    instance.rerender(<ActivityMcpForm hidden />)
    await Bun.sleep(60)
    expect(terminalText(output)).toContain('Higher priority prompt')
    expect(terminalText(output)).not.toContain('MCP form request')
    await press(stdin, '\x1b[D')

    instance.rerender(<ActivityMcpForm hidden={false} />)
    await Bun.sleep(60)
    expect(terminalText(output)).toContain('green ✓')
  } finally {
    stdout.isTTY = false
    instance.unmount()
    instance.cleanup()
  }
})

test('MCP input capture takes priority over listeners from covered screens', () => {
  const eventEmitter = new EventEmitter()
  const received: string[] = []
  const inputHandlerRef: { current: McpElicitationInputHandler | null } = {
    current: input => received.push(`prompt:${input}`),
  }
  eventEmitter.on('input', () => received.push('screen'))
  const dispose = bindMcpElicitationInput(eventEmitter, inputHandlerRef)
  const event = new InputEvent({
    name: 'x', sequence: 'x', ctrl: false, shift: false, meta: false, option: false, fn: false,
  } as never)

  eventEmitter.emit('input', event)
  expect(received).toEqual(['prompt:x'])
  dispose()
})

test('renders server and reason as plain text and accepts typed defaults after review', async () => {
  let result: McpElicitationResponse | undefined
  const displayRequest = {
    ...request,
    serverName: '\x1b[31mprofile-store\x1b[0m',
    message: 'Choose the values to save: https://example.com/profile',
  }
  const prompt = renderPrompt({ request: displayRequest, onAccept: content => { result = { action: 'accept', content } } })
  try {
    await Bun.sleep(80)
    const rendered = plain(prompt.rendered())
    expect(rendered).toContain('MCPformrequest')
    expect(rendered).toContain('fromprofile-store')
    expect(rendered).toContain('https://example.com/profile')
    expect(rendered).toContain('Ada')
    expect(prompt.rendered()).not.toContain('\x1b]8;;')
    await press(prompt.stdin, '\t')
    await press(prompt.stdin, '\r')
    expect(result).toEqual({
      action: 'accept',
      content: { name: 'Ada', age: 42, score: 7.5, enabled: true, color: 'blue', mode: 'safe', features: ['search'] },
    })
  } finally {
    cleanup(prompt)
  }
})

test('sanitizes carriage returns from server supplied text', async () => {
  const prompt = renderPrompt({ request: { ...request, message: 'BAD!\rSAFE' } })
  try {
    await Bun.sleep(80)
    expect(prompt.rendered()).not.toContain('BAD!\rSAFE')
    expect(plain(prompt.rendered())).toContain('BAD!SAFE')
  } finally {
    cleanup(prompt)
  }
})

test('edits text, numeric, boolean, enum, oneOf, and enum-list fields', async () => {
  let result: McpElicitationResponse | undefined
  const prompt = renderPrompt({ onAccept: content => { result = { action: 'accept', content } } })
  try {
    await Bun.sleep(80)
    for (const character of ' Lin') await press(prompt.stdin, character)
    await press(prompt.stdin, '\r')
    await press(prompt.stdin, '\x7f')
    await press(prompt.stdin, '8')
    await press(prompt.stdin, '\r')
    await press(prompt.stdin, '9')
    await press(prompt.stdin, '\r')
    await press(prompt.stdin, 'n')
    await press(prompt.stdin, '\r')
    await press(prompt.stdin, '\x1b[C')
    await press(prompt.stdin, '\r')
    await press(prompt.stdin, '\x1b[C')
    await press(prompt.stdin, '\r')
    await press(prompt.stdin, '2')
    await press(prompt.stdin, '\r')
    await press(prompt.stdin, '\r')
    expect(result).toEqual({
      action: 'accept',
      content: { name: 'Ada Lin', age: 48, score: 7.59, enabled: false, color: 'green', mode: 'fast', features: ['search', 'preview'] },
    })
  } finally {
    cleanup(prompt)
  }
})

test('clears optional enum and boolean values back to undefined', async () => {
  let result: unknown
  const clearRequest: McpElicitationRequest = {
    serverName: 'profile-store',
    message: 'Set optional values.',
    requestedSchema: {
      type: 'object',
      properties: {
        color: { type: 'string', enum: ['red', 'blue'], default: 'red' },
        enabled: { type: 'boolean', default: true },
        mode: { type: 'string', enum: ['safe', 'fast'] },
      },
    },
  }
  const prompt = renderPrompt({ request: clearRequest, onAccept: content => { result = content } })
  try {
    await Bun.sleep(80)
    expect(plain(prompt.rendered())).toContain('Backspaceclearsoptionalvalue')
    await press(prompt.stdin, '\x7f')
    await press(prompt.stdin, '\r')
    await press(prompt.stdin, '\x7f')
    await press(prompt.stdin, '\r')
    await press(prompt.stdin, '\x1b[C')
    await press(prompt.stdin, '\x7f')
    await press(prompt.stdin, '\t')
    await press(prompt.stdin, '\r')
    expect(result).toEqual({})
  } finally {
    cleanup(prompt)
  }
})

test('keeps required-field validation when an enum value is cleared', async () => {
  let accepted: unknown
  const requiredRequest: McpElicitationRequest = {
    serverName: 'profile-store',
    message: 'Choose a required value.',
    requestedSchema: {
      type: 'object',
      properties: { color: { type: 'string', enum: ['red', 'blue'], default: 'red' } },
      required: ['color'],
    },
  }
  const prompt = renderPrompt({ request: requiredRequest, onAccept: content => { accepted = content } })
  try {
    await Bun.sleep(80)
    await press(prompt.stdin, '\x7f')
    await press(prompt.stdin, '\t')
    await press(prompt.stdin, '\r')
    expect(accepted).toBeUndefined()
    expect(plain(prompt.rendered())).toContain('Thisfieldisrequired.')
  } finally {
    cleanup(prompt)
  }
})

test('edits fields with an empty property name', async () => {
  let accepted: unknown
  const emptyNameRequest: McpElicitationRequest = {
    serverName: 'profile-store',
    message: 'Provide a value.',
    requestedSchema: { type: 'object', properties: { '': { type: 'string' } } },
  }
  const prompt = renderPrompt({ request: emptyNameRequest, onAccept: content => { accepted = content } })
  try {
    await Bun.sleep(80)
    await press(prompt.stdin, 'x')
    await press(prompt.stdin, '\t')
    await press(prompt.stdin, '\r')
    expect(accepted).toEqual({ '': 'x' })
  } finally {
    cleanup(prompt)
  }
})

test('left and right arrows navigate from the initially highlighted enum option', async () => {
  let leftAccepted: unknown
  let rightAccepted: unknown
  const enumRequest: McpElicitationRequest = {
    serverName: 'profile-store',
    message: 'Choose a color.',
    requestedSchema: {
      type: 'object',
      properties: { color: { type: 'string', enum: ['red', 'green', 'blue'] } },
      required: ['color'],
    },
  }
  const leftPrompt = renderPrompt({ request: enumRequest, onAccept: content => { leftAccepted = content } })
  const rightPrompt = renderPrompt({ request: enumRequest, onAccept: content => { rightAccepted = content } })
  try {
    await Bun.sleep(80)
    await press(leftPrompt.stdin, '\x1b[D')
    await press(leftPrompt.stdin, '\t')
    await press(leftPrompt.stdin, '\r')
    await press(rightPrompt.stdin, '\x1b[C')
    await press(rightPrompt.stdin, '\t')
    await press(rightPrompt.stdin, '\r')
    expect(leftAccepted).toEqual({ color: 'blue' })
    expect(rightAccepted).toEqual({ color: 'green' })
  } finally {
    cleanup(leftPrompt)
    cleanup(rightPrompt)
  }
})

test('keeps invalid required formats and bounds in review until corrected', async () => {
  let accepted: unknown
  const invalidRequest: McpElicitationRequest = {
    serverName: 'profile-store',
    message: 'Provide an email and count.',
    requestedSchema: {
      type: 'object',
      properties: {
        email: { type: 'string', format: 'email' },
        count: { type: 'integer', minimum: 2, maximum: 4 },
      },
      required: ['email', 'count'],
    },
  }
  const prompt = renderPrompt({ request: invalidRequest, onAccept: content => { accepted = content } })
  try {
    await Bun.sleep(80)
    const malformedEmail = 'foo(bar)@example.com'
    for (const character of malformedEmail) await press(prompt.stdin, character)
    await press(prompt.stdin, '\r')
    await press(prompt.stdin, '1')
    await press(prompt.stdin, '\r')
    await press(prompt.stdin, '\r')
    expect(accepted).toBeUndefined()
    expect(plain(prompt.rendered())).toContain('validemail')
    await press(prompt.stdin, '\t')
    for (let index = 0; index < malformedEmail.length; index++) await press(prompt.stdin, '\x7f')
    for (const character of 'test@example.com') await press(prompt.stdin, character)
    await press(prompt.stdin, '\r')
    await press(prompt.stdin, '\x7f')
    for (const character of '3') await press(prompt.stdin, character)
    await press(prompt.stdin, '\t')
    await press(prompt.stdin, '\r')
    expect(accepted).toEqual({ email: 'test@example.com', count: 3 })
  } finally {
    cleanup(prompt)
  }
})

test('validates missing required fields before accepting', async () => {
  let accepted = false
  const requiredRequest: McpElicitationRequest = {
    serverName: 'profile-store',
    message: 'Provide a display name.',
    requestedSchema: {
      type: 'object',
      properties: { displayName: { type: 'string', minLength: 1 } },
      required: ['displayName'],
    },
  }
  const prompt = renderPrompt({ request: requiredRequest, onAccept: () => { accepted = true } })
  try {
    await Bun.sleep(80)
    await press(prompt.stdin, '\t')
    await press(prompt.stdin, '\r')
    expect(accepted).toBe(false)
    expect(plain(prompt.rendered())).toContain('Thisfieldisrequired.')
  } finally {
    cleanup(prompt)
  }
})

test('accepts valid date, date-time, and URI fields as text values', async () => {
  let accepted: unknown
  const formatRequest: McpElicitationRequest = {
    serverName: 'profile-store',
    message: 'Save the profile metadata.',
    requestedSchema: {
      type: 'object',
      properties: {
        date: { type: 'string', format: 'date', default: '2026-06-01' },
        timestamp: { type: 'string', format: 'date-time', default: '2026-06-01T12:30:00Z' },
        website: { type: 'string', format: 'uri', default: 'https://example.com/profile' },
      },
      required: ['date', 'timestamp', 'website'],
    },
  }
  const prompt = renderPrompt({ request: formatRequest, onAccept: content => { accepted = content } })
  try {
    await Bun.sleep(80)
    await press(prompt.stdin, '\t')
    await press(prompt.stdin, '\r')
    expect(accepted).toEqual({
      date: '2026-06-01',
      timestamp: '2026-06-01T12:30:00Z',
      website: 'https://example.com/profile',
    })
  } finally {
    cleanup(prompt)
  }
})

test('rejects a date-time whose calendar date would otherwise be normalized', async () => {
  let accepted = false
  const timestampRequest: McpElicitationRequest = {
    serverName: 'profile-store',
    message: 'Provide the event timestamp.',
    requestedSchema: {
      type: 'object',
      properties: { timestamp: { type: 'string', format: 'date-time' } },
      required: ['timestamp'],
    },
  }
  const prompt = renderPrompt({ request: timestampRequest, onAccept: () => { accepted = true } })
  try {
    await Bun.sleep(80)
    for (const character of '2024-02-30T12:30:00Z') await press(prompt.stdin, character)
    await press(prompt.stdin, '\t')
    await press(prompt.stdin, '\r')
    expect(accepted).toBe(false)
    expect(plain(prompt.rendered())).toContain('validdate-time')
  } finally {
    cleanup(prompt)
  }
})

test('sanitizes server enum labels again in the review screen', async () => {
  const label = '\x1b]8;;https://example.com\x07Preview\x1b]8;;\x07'
  const arrayRequest: McpElicitationRequest = {
    serverName: 'profile-store',
    message: 'Choose features.',
    requestedSchema: {
      type: 'object',
      properties: { features: { type: 'array', items: { anyOf: [{ const: 'preview', title: label }] }, default: ['preview'] } },
    },
  }
  const prompt = renderPrompt({ request: arrayRequest })
  try {
    await Bun.sleep(80)
    await press(prompt.stdin, '\t')
    expect(prompt.rendered()).not.toContain('\x1b]8;;')
    expect(plain(prompt.rendered())).toContain('Preview')
  } finally {
    cleanup(prompt)
  }
})

test('does not render or retain an authenticator code form', async () => {
  let accepted = false
  let declined = false
  const credentialRequest: McpElicitationRequest = {
    serverName: 'profile-store',
    message: 'Enter the current code from your authenticator app.',
    requestedSchema: {
      type: 'object',
      properties: { code: { type: 'string', title: 'Authenticator code', default: '123456' } },
      required: ['code'],
    },
  }
  const prompt = renderPrompt({
    request: credentialRequest,
    onAccept: () => { accepted = true },
    onDecline: () => { declined = true },
  })
  try {
    await Bun.sleep(80)
    expect(plain(prompt.rendered())).toContain('Novalueswillbecollected')
    expect(plain(prompt.rendered())).not.toContain('123456')
    await press(prompt.stdin, '\r')
    expect(accepted).toBe(false)
    expect(declined).toBe(true)
  } finally {
    cleanup(prompt)
  }
})

for (const { label, message, fieldName, title } of [
  { label: 'MFA', message: 'Enter your MFA code.', fieldName: 'mfaCode', title: 'MFA code' },
  { label: '2FA', message: 'Enter your 2FA code.', fieldName: 'twoFactorCode', title: '2FA code' },
  { label: 'MFA recovery', message: 'Enter your MFA recovery code.', fieldName: 'mfaRecoveryCode', title: 'MFA recovery code' },
  { label: '2FA backup', message: 'Enter your 2FA backup code.', fieldName: 'twoFactorBackupCode', title: '2FA backup code' },
  { label: 'two-factor recovery', message: 'Continue with profile setup.', fieldName: 'twoFactorRecoveryCode', title: 'Recovery details' },
  { label: 'multi-factor backup', message: 'Continue with profile setup.', fieldName: 'multiFactorBackupCode', title: 'Backup details' },
]) {
  test(`does not render or retain a ${label} code form`, async () => {
    let accepted = false
    const credentialRequest: McpElicitationRequest = {
      serverName: 'profile-store',
      message,
      requestedSchema: {
        type: 'object',
        properties: { [fieldName]: { type: 'string', title, default: '123456' } },
        required: [fieldName],
      },
    }
    const prompt = renderPrompt({ request: credentialRequest, onAccept: () => { accepted = true } })
    try {
      await Bun.sleep(80)
      expect(plain(prompt.rendered())).toContain('Novalueswillbecollected')
      expect(plain(prompt.rendered())).not.toContain('123456')
      await press(prompt.stdin, '\r')
      expect(accepted).toBe(false)
    } finally {
      cleanup(prompt)
    }
  })
}

test('supports field names that shadow object prototype properties', async () => {
  let accepted: unknown
  const properties = Object.create(null) as McpElicitationSchema['properties']
  Object.defineProperty(properties, 'constructor', { value: { type: 'string' }, enumerable: true, writable: true, configurable: true })
  Object.defineProperty(properties, '__proto__', { value: { type: 'string', default: 'safe' }, enumerable: true, writable: true, configurable: true })
  const prototypeRequest: McpElicitationRequest = {
    serverName: 'profile-store',
    message: 'Set both values.',
    requestedSchema: { type: 'object', properties, required: ['constructor', '__proto__'] },
  }
  const prompt = renderPrompt({ request: prototypeRequest, onAccept: content => { accepted = content } })
  try {
    await Bun.sleep(80)
    await press(prompt.stdin, 'C')
    await press(prompt.stdin, '\r')
    await press(prompt.stdin, '\t')
    await press(prompt.stdin, '\r')
    expect(Object.getOwnPropertyDescriptor(accepted, 'constructor')?.value).toBe('C')
    expect(Object.prototype.hasOwnProperty.call(accepted, '__proto__')).toBe(true)
    expect(Object.getOwnPropertyDescriptor(accepted, '__proto__')?.value).toBe('safe')
  } finally {
    cleanup(prompt)
  }
})

test('decline, Escape, and Ctrl+C produce distinct UI outcomes', async () => {
  let declined = 0
  let cancelled = 0
  const declinePrompt = renderPrompt({ onDecline: () => { declined++ } })
  const escapePrompt = renderPrompt({ onCancel: () => { cancelled++ } })
  const ctrlCPrompt = renderPrompt({ onCancel: () => { cancelled++ } })
  try {
    await Bun.sleep(80)
    await press(declinePrompt.stdin, '\t')
    await press(declinePrompt.stdin, '\x1b[C')
    await press(declinePrompt.stdin, '\r')
    await press(escapePrompt.stdin, '\x1b')
    await press(ctrlCPrompt.stdin, '\x03')
    expect(declined).toBe(1)
    expect(cancelled).toBe(2)
  } finally {
    cleanup(declinePrompt)
    cleanup(escapePrompt)
    cleanup(ctrlCPrompt)
  }
})

function fakeAgent() {
  let handler: McpElicitationHandler | null = null
  return {
    get handler() { return handler },
    setMcpElicitationHandler(value: McpElicitationHandler | null) { handler = value },
  }
}

const queueRequest = (message: string): McpElicitationRequest => ({
  serverName: 'queue-test',
  message,
  requestedSchema: { type: 'object', properties: {} },
})

test('queues concurrent requests FIFO and aborts only the matching active request', async () => {
  const agent = fakeAgent()
  const visible: McpElicitationPromptState[] = []
  const dispose = bindMcpElicitationPrompt(agent, state => { if (state) visible.push(state) })
  const firstAbort = new AbortController()
  const secondAbort = new AbortController()
  const first = agent.handler!(queueRequest('first'), firstAbort.signal)
  const second = agent.handler!(queueRequest('second'), secondAbort.signal)
  expect(visible.map(item => item.request.message)).toEqual(['first'])

  firstAbort.abort()
  await expect(first).resolves.toEqual({ action: 'cancel' })
  expect(visible.map(item => item.request.message)).toEqual(['first', 'second'])
  visible[1]!.resolve({ action: 'decline' })
  await expect(second).resolves.toEqual({ action: 'decline' })
  dispose()
  expect(agent.handler).toBeNull()
})

test('aborting a queued request leaves the active request intact and cleanup cancels remaining calls', async () => {
  const agent = fakeAgent()
  const visible: McpElicitationPromptState[] = []
  const dispose = bindMcpElicitationPrompt(agent, state => { if (state) visible.push(state) })
  const firstAbort = new AbortController()
  const secondAbort = new AbortController()
  const thirdAbort = new AbortController()
  const first = agent.handler!(queueRequest('first'), firstAbort.signal)
  const second = agent.handler!(queueRequest('second'), secondAbort.signal)
  const third = agent.handler!(queueRequest('third'), thirdAbort.signal)

  secondAbort.abort()
  await expect(second).resolves.toEqual({ action: 'cancel' })
  expect(visible.at(-1)?.request.message).toBe('first')
  dispose()
  await expect(first).resolves.toEqual({ action: 'cancel' })
  await expect(third).resolves.toEqual({ action: 'cancel' })
  expect(agent.handler).toBeNull()
})
