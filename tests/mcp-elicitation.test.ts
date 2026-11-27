import { afterEach, describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Agent } from '../src/agent/agent.js'
import { approveMcpConfig, loadMcpTools, type McpLoadOptions } from '../src/agent/mcp.js'
import { createMcpElicitationRedactionTracker, handleMcpElicitationRequest, type McpElicitationContent, type McpElicitationSchema } from '../src/agent/mcpElicitation.js'
import type { ElicitRequestParams } from '@modelcontextprotocol/sdk/types.js'
import { sandboxAvailable } from '../src/utils/platform.js'

const roots: string[] = []
const sandboxTest = it.skipIf(!sandboxAvailable())

afterEach(async () => Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))))

const formSchema = {
  type: 'object',
  properties: {
    displayName: { type: 'string', minLength: 1, maxLength: 40 },
    age: { type: 'integer', minimum: 0, maximum: 130 },
    color: { type: 'string', enum: ['blue', 'green'] },
  },
  required: ['displayName', 'color'],
} as const satisfies McpElicitationSchema

function formRequest(requestedSchema: unknown = formSchema): ElicitRequestParams {
  return {
    mode: 'form',
    message: 'Share a display name and choose a color.',
    requestedSchema,
  } as ElicitRequestParams
}

describe('MCP form elicitation validation', () => {
  it('returns accepted scalar and enum data only after schema validation', async () => {
    const result = await handleMcpElicitationRequest('profile-store', formRequest(), async request => {
      expect(request.serverName).toBe('profile-store')
      expect(request.message).toContain('display name')
      return { action: 'accept', content: { displayName: 'Ada', age: 37, color: 'blue' } }
    }, new AbortController().signal)

    expect(result).toEqual({ action: 'accept', content: { displayName: 'Ada', age: 37, color: 'blue' } })
  })

  it('preserves decline and cancel as distinct user responses', async () => {
    for (const action of ['decline', 'cancel'] as const) {
      await expect(handleMcpElicitationRequest('profile-store', formRequest(), async () => ({ action }), new AbortController().signal))
        .resolves.toEqual({ action })
    }
  })

  it('rejects an unsupported schema and a form that requests sensitive information', async () => {
    await expect(handleMcpElicitationRequest('profile-store', formRequest({
      type: 'object', properties: { nested: { type: 'object', properties: { value: { type: 'string' } } } },
    }), async () => ({ action: 'decline' }), new AbortController().signal)).rejects.toThrow(/unsupported or unsafe schema/)

    await expect(handleMcpElicitationRequest('profile-store', formRequest({
      type: 'object', properties: { credential: { type: 'string' } },
    }), async () => ({ action: 'decline' }), new AbortController().signal)).rejects.toThrow(/unsupported or unsafe schema/)

    await expect(handleMcpElicitationRequest('profile-store', {
      ...formRequest(), message: 'Please provide your access token.',
    }, async () => ({ action: 'decline' }), new AbortController().signal)).rejects.toThrow(/unsupported or unsafe schema/)
  })

  it('accepts string-typed enum arrays and validates each selected choice', async () => {
    const requestedSchema = {
      type: 'object',
      properties: {
        tags: { type: 'array', items: { type: 'string', enum: ['alpha', 'beta'] } },
        modes: { type: 'array', items: { type: 'string', anyOf: [{ const: 'read', title: 'Read' }, { const: 'write', title: 'Write' }] } },
      },
      required: ['tags', 'modes'],
    }
    const content = { tags: ['alpha', 'beta'], modes: ['read'] }

    await expect(handleMcpElicitationRequest('profile-store', formRequest(requestedSchema), async () => ({ action: 'accept', content }), new AbortController().signal))
      .resolves.toEqual({ action: 'accept', content })

    let handlerCalls = 0
    await expect(handleMcpElicitationRequest('profile-store', formRequest({
      type: 'object', properties: { tags: { type: 'array', items: { type: 'number', enum: ['alpha'] } } },
    }), async () => { handlerCalls++; return { action: 'decline' } }, new AbortController().signal)).rejects.toThrow(/unsupported or unsafe schema/)
    expect(handlerCalls).toBe(0)

    await expect(handleMcpElicitationRequest('profile-store', formRequest(requestedSchema), async () => ({
      action: 'accept', content: { tags: ['unknown'], modes: ['read'] },
    }), new AbortController().signal)).rejects.toThrow(/does not match the requested schema/)

    let duplicateDefaultHandlerCalls = 0
    await expect(handleMcpElicitationRequest('profile-store', formRequest({
      type: 'object',
      properties: { tags: { type: 'array', items: { type: 'string', enum: ['alpha', 'beta'] }, default: ['alpha', 'alpha'] } },
    }), async () => { duplicateDefaultHandlerCalls++; return { action: 'decline' } }, new AbortController().signal))
      .rejects.toThrow(/unsupported or unsafe schema/)
    expect(duplicateDefaultHandlerCalls).toBe(0)

    await expect(handleMcpElicitationRequest('profile-store', formRequest({
      type: 'object',
      properties: { tags: { type: 'array', items: { type: 'string', enum: ['alpha'], anyOf: [{ const: 'beta', title: 'Beta' }] } } },
    }), async () => ({ action: 'accept', content: { tags: ['alpha'] } }), new AbortController().signal))
      .rejects.toThrow(/unsupported or unsafe schema/)
  })

  it('rejects impossible calendar dates in date-time values without normalizing them', async () => {
    const requestedSchema = {
      type: 'object',
      properties: { createdAt: { type: 'string', format: 'date-time' } },
      required: ['createdAt'],
    }

    await expect(handleMcpElicitationRequest('profile-store', formRequest(requestedSchema), async () => ({
      action: 'accept', content: { createdAt: '2024-02-30T12:30:00Z' },
    }), new AbortController().signal)).rejects.toThrow(/does not match the requested schema/)

    await expect(handleMcpElicitationRequest('profile-store', formRequest(requestedSchema), async () => ({
      action: 'accept', content: { createdAt: '2024-02-29T12:30:00Z' },
    }), new AbortController().signal)).resolves.toEqual({
      action: 'accept', content: { createdAt: '2024-02-29T12:30:00Z' },
    })
  })

  it('restricts email local-parts to dot-atom syntax and rejects empty domain labels', async () => {
    const requestedSchema = {
      type: 'object',
      properties: { email: { type: 'string', format: 'email' } },
      required: ['email'],
    }

    for (const email of ['a@b..com', 'foo(bar)@example.com']) {
      await expect(handleMcpElicitationRequest('profile-store', formRequest(requestedSchema), async () => ({
        action: 'accept', content: { email },
      }), new AbortController().signal)).rejects.toThrow(/does not match the requested schema/)
    }
    await expect(handleMcpElicitationRequest('profile-store', formRequest(requestedSchema), async () => ({
      action: 'accept', content: { email: 'ada@example.com' },
    }), new AbortController().signal)).resolves.toEqual({
      action: 'accept', content: { email: 'ada@example.com' },
    })
  })

  it('rejects sparse array responses even when their length meets minItems', async () => {
    const requestedSchema = {
      type: 'object',
      properties: { tags: { type: 'array', items: { type: 'string', enum: ['alpha'] }, minItems: 1 } },
      required: ['tags'],
    }
    const sparse = Array(1) as string[]

    await expect(handleMcpElicitationRequest('profile-store', formRequest(requestedSchema), async () => ({
      action: 'accept', content: { tags: sparse },
    }), new AbortController().signal)).rejects.toThrow(/does not match the requested schema/)
  })

  it('retains redaction values outside active calls, matches case-insensitively, and releases them on disposal', () => {
    const tracker = createMcpElicitationRedactionTracker()
    tracker.record({ email: 'Ada@example.com' })

    const firstScope = tracker.begin()
    expect(firstScope.redactText('echo ada@example.com')).toBe('echo [redacted MCP elicitation value]')
    firstScope.close()

    const laterScope = tracker.begin()
    tracker.dispose()
    expect(laterScope.redactValue({ email: 'ada@EXAMPLE.com' })).toEqual({ email: '[redacted MCP elicitation value]' })
    laterScope.close()
    expect(() => tracker.begin()).toThrow(/no longer available/)

    const boundedTracker = createMcpElicitationRedactionTracker()
    const oversizedValue = 'x'.repeat(64 * 1024 + 1)
    expect(() => boundedTracker.record({ value: oversizedValue })).toThrow(/capacity exceeded/)
    boundedTracker.dispose()
  })

  it('blocks OTP and authenticator verification codes before they reach the UI handler', async () => {
    const requests = [
      { key: 'code', title: 'Authenticator code', message: 'Enter the current code from your authenticator app.' },
      { key: 'otp', title: 'OTP', message: 'Enter your OTP code.' },
      { key: 'verificationCode', title: 'Verification code', message: 'Enter the code.' },
      { key: 'authenticationCode', title: 'Authentication code', message: 'Enter the code.' },
    ]
    let handlerCalls = 0

    for (const request of requests) {
      await expect(handleMcpElicitationRequest('profile-store', {
        mode: 'form',
        message: request.message,
        requestedSchema: { type: 'object', properties: { [request.key]: { type: 'string', title: request.title } } },
      }, async () => { handlerCalls++; return { action: 'decline' } }, new AbortController().signal))
        .rejects.toThrow(/unsupported or unsafe schema/)
    }

    expect(handlerCalls).toBe(0)
  })

  it('blocks explicit MFA and 2FA codes from messages, labels, descriptions, and camelCase fields', async () => {
    const requests = [
      {
        message: 'Enter the current MFA code to continue.',
        requestedSchema: { type: 'object', properties: { code: { type: 'string' } }, required: ['code'] },
      },
      {
        message: 'Complete your profile.',
        requestedSchema: { type: 'object', properties: { mfaCode: { type: 'string', title: 'Required value', default: '123456' } }, required: ['mfaCode'] },
      },
      {
        message: 'Complete your profile.',
        requestedSchema: { type: 'object', properties: { twoFactorCode: { type: 'string', default: '654321' } }, required: ['twoFactorCode'] },
      },
      {
        message: 'Complete your profile.',
        requestedSchema: { type: 'object', properties: { code: { type: 'string', title: '2FA verification code' } }, required: ['code'] },
      },
      {
        message: 'Complete your profile.',
        requestedSchema: { type: 'object', properties: { code: { type: 'string', description: 'Enter the two-factor authentication code.' } }, required: ['code'] },
      },
      {
        message: 'Complete your profile.',
        requestedSchema: { type: 'object', properties: { code: { type: 'string', description: 'Enter the MFA: authentication code.' } }, required: ['code'] },
      },
    ]
    let handlerCalls = 0

    for (const request of requests) {
      await expect(handleMcpElicitationRequest('profile-store', {
        ...formRequest(request.requestedSchema),
        message: request.message,
      }, async () => { handlerCalls++; return { action: 'accept', content: { code: '123456', mfaCode: '123456', twoFactorCode: '654321' } } }, new AbortController().signal))
        .rejects.toThrow(/unsupported or unsafe schema/)
    }

    expect(handlerCalls).toBe(0)
  })

  it('blocks MFA and 2FA recovery or backup codes before invoking the handler', async () => {
    const requests = [
      {
        message: 'Enter your MFA recovery code.',
        requestedSchema: { type: 'object', properties: { recoveryCode: { type: 'string' } }, required: ['recoveryCode'] },
      },
      {
        message: 'Continue to your account.',
        requestedSchema: { type: 'object', properties: { code: { type: 'string', title: 'MFA recovery code' } }, required: ['code'] },
      },
      {
        message: 'Continue to your account.',
        requestedSchema: { type: 'object', properties: { mfaRecoveryCode: { type: 'string', default: 'recovery-value' } }, required: ['mfaRecoveryCode'] },
      },
      {
        message: 'Continue to your account.',
        requestedSchema: { type: 'object', properties: { mfaBackupCode: { type: 'string' } }, required: ['mfaBackupCode'] },
      },
      {
        message: 'Enter your 2FA backup code.',
        requestedSchema: { type: 'object', properties: { code: { type: 'string', default: 'backup-value' } }, required: ['code'] },
      },
      {
        message: 'Continue to your account.',
        requestedSchema: { type: 'object', properties: { twoFactorBackupCode: { type: 'string' } }, required: ['twoFactorBackupCode'] },
      },
      {
        message: 'Continue to your account.',
        requestedSchema: { type: 'object', properties: { twoFactorBackupCodes: { type: 'string' } }, required: ['twoFactorBackupCodes'] },
      },
      {
        message: 'Continue to your account.',
        requestedSchema: { type: 'object', properties: { code: { type: 'string', description: 'Store the 2FA recovery code here.' } }, required: ['code'] },
      },
      {
        message: 'Continue to your account.',
        requestedSchema: { type: 'object', properties: { code: { type: 'string', description: 'Use this recovery code for MFA.' } }, required: ['code'] },
      },
    ]
    let handlerCalls = 0

    for (const request of requests) {
      await expect(handleMcpElicitationRequest('profile-store', {
        ...formRequest(request.requestedSchema),
        message: request.message,
      }, async () => { handlerCalls++; return { action: 'accept', content: { recoveryCode: 'recovery-value', code: 'backup-value', mfaRecoveryCode: 'recovery-value', twoFactorBackupCode: 'backup-value' } } }, new AbortController().signal))
        .rejects.toThrow(/unsupported or unsafe schema/)
    }

    expect(handlerCalls).toBe(0)
  })

  it('redacts short string, numeric, and boolean Base64 values as complete case-sensitive tokens', () => {
    const tracker = createMcpElicitationRedactionTracker()
    const secret = 'Ada+tag@example.com'
    const urlSecret = 'Ada+tag😀@example.com'
    const shortValue = 'cat'
    const numericValue = 123456
    const paddedNumericValue = 12345678
    const booleanValue = true
    const encoded = Buffer.from(secret, 'utf8').toString('base64')
    const encodedUrl = Buffer.from(urlSecret, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_')
    const encodedShort = Buffer.from(shortValue, 'utf8').toString('base64')
    const encodedNumber = Buffer.from(String(numericValue), 'utf8').toString('base64')
    const encodedPaddedNumber = Buffer.from(String(paddedNumericValue), 'utf8').toString('base64')
    const encodedBoolean = Buffer.from(String(booleanValue), 'utf8').toString('base64')
    tracker.record({ email: secret, urlEmail: urlSecret, short: shortValue, numeric: numericValue, paddedNumeric: paddedNumericValue, enabled: booleanValue })
    const scope = tracker.begin()

    expect(encoded).toBe('QWRhK3RhZ0BleGFtcGxlLmNvbQ==')
    expect(scope.redactText(`echo ${encoded}`)).toBe('echo [redacted MCP elicitation value]')
    expect(scope.redactText(`echo ${encodedUrl}`)).toBe('echo [redacted MCP elicitation value]')
    expect(scope.redactText(`!${encodedShort}!`)).toBe('![redacted MCP elicitation value]!')
    expect(scope.redactText(` ${encodedNumber},${encodedBoolean}.`)).toBe(' [redacted MCP elicitation value],[redacted MCP elicitation value].')
    expect(scope.redactText(`count=${encodedNumber}`)).toBe('count=[redacted MCP elicitation value]')
    expect(scope.redactValue({ count: `count=${encodedNumber}` })).toEqual({ count: 'count=[redacted MCP elicitation value]' })
    expect(encodedPaddedNumber).toBe('MTIzNDU2Nzg=')
    expect(scope.redactText(` ${encodedPaddedNumber} `)).toBe(' [redacted MCP elicitation value] ')
    expect(scope.redactText(`count=${encodedPaddedNumber}=`)).toBe('count=[redacted MCP elicitation value]')
    expect(scope.redactText(`count=${encodedPaddedNumber}=== `)).toBe(`count=${encodedPaddedNumber}=== `)
    expect(scope.redactText(`count=${encodedPaddedNumber}==A `)).toBe(`count=${encodedPaddedNumber}==A `)
    expect(scope.redactText(`x${encodedShort}x`)).toBe(`x${encodedShort}x`)
    expect(scope.redactText('The catalog is ready')).toBe('The catalog is ready')
    expect(scope.redactText('A cat is ready')).toBe('A [redacted MCP elicitation value] is ready')
    expect(scope.redactText('A CAT is ready')).toBe('A [redacted MCP elicitation value] is ready')
    expect(scope.redactText('The cafécat is ready')).toBe('The cafécat is ready')
    expect(scope.redactText('The cafe\u0301cat is ready')).toBe('The cafe\u0301cat is ready')
    expect(scope.redactText(encoded.toLowerCase())).toBe(encoded.toLowerCase())

    scope.close()
    tracker.dispose()
  })

  it('rejects accepted content with missing required, extra, wrong-type, or out-of-range values', async () => {
    const invalidContent: Array<Record<string, unknown>> = [
      { displayName: 'Ada' },
      { displayName: 'Ada', color: 'red' },
      { displayName: 'Ada', color: 'blue', age: '37' },
      { displayName: 'Ada', color: 'blue', age: 131 },
      { displayName: 'Ada', color: 'blue', unexpected: true },
    ]

    for (const content of invalidContent) {
      await expect(handleMcpElicitationRequest('profile-store', formRequest(), async () => ({ action: 'accept', content: content as McpElicitationContent }), new AbortController().signal))
        .rejects.toThrow(/does not match the requested schema/)
    }
  })

  it('rejects URL mode and fast-fails when no interactive UI handler is registered', async () => {
    await expect(handleMcpElicitationRequest('profile-store', {
      mode: 'url', message: 'Continue at the external page.', url: 'https://example.invalid', elicitationId: 'id-1',
    }, async () => ({ action: 'decline' }), new AbortController().signal)).rejects.toThrow(/Only form-mode/)

    await expect(handleMcpElicitationRequest('profile-store', formRequest(), undefined, new AbortController().signal))
      .rejects.toThrow(/no interactive UI handler/)
  })

  it('passes the MCP request signal through and stops waiting when it is aborted', async () => {
    const controller = new AbortController()
    let receivedSignal: AbortSignal | undefined
    const pending = handleMcpElicitationRequest('profile-store', formRequest(), async (_request, signal) => {
      receivedSignal = signal
      return new Promise(() => {})
    }, controller.signal)

    await Promise.resolve()
    expect(receivedSignal).toBe(controller.signal)
    controller.abort()
    await expect(pending).rejects.toThrow(/request was cancelled/)
  })

  it('uses a dynamic handler for an interactive Agent and leaves default sessions without the capability', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-agent-mcp-elicitation-'))
    roots.push(root)
    const interactive = new Agent({ provider: 'deepseek', apiKey: 'test-key' }, {
      projectRoot: root,
      logFile: null,
      snapshotFile: null,
      enableMcpFormElicitation: true,
    })
    await interactive.readyPromise

    const options = (interactive as any).mcpLoadOptions(true)
    expect(options.enableFormElicitation).toBe(true)
    await expect(options.mcpElicitationHandler({ serverName: 'profile-store', message: 'Choose a color.', requestedSchema: formSchema }, new AbortController().signal))
      .rejects.toThrow(/no interactive UI handler/)

    interactive.setMcpElicitationHandler(async request => ({
      action: 'accept',
      content: { displayName: request.serverName, color: 'blue' },
    }))
    await expect(options.mcpElicitationHandler({ serverName: 'profile-store', message: 'Choose a color.', requestedSchema: formSchema }, new AbortController().signal))
      .resolves.toEqual({ action: 'accept', content: { displayName: 'profile-store', color: 'blue' } })

    const nonInteractive = new Agent({ provider: 'deepseek', apiKey: 'test-key' }, {
      projectRoot: root,
      logFile: null,
      snapshotFile: null,
    })
    await nonInteractive.readyPromise
    const nonInteractiveOptions = (nonInteractive as any).mcpLoadOptions(true)
    expect(nonInteractiveOptions.enabled).toBe(true)
    expect(nonInteractiveOptions.enableFormElicitation).toBeUndefined()
    expect(nonInteractiveOptions.mcpElicitationHandler).toBeUndefined()
  })
})

describe('MCP elicitation client integration', () => {
  async function loadElicitationFixture(options: {
    enableFormElicitation?: McpLoadOptions['enableFormElicitation']
    mcpElicitationHandler?: McpLoadOptions['mcpElicitationHandler']
    elicitationSchema?: McpElicitationSchema
    echoElicitation?: boolean
    echoStructuredContent?: boolean
    lowercaseElicitationEcho?: boolean
    percentEncodeElicitationEcho?: boolean
    base64Encoding?: 'standard' | 'url-padded' | 'url-unpadded'
    base64KeyValueEcho?: boolean
    extraBase64Padding?: boolean
  } = {}) {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-mcp-elicitation-server-'))
    roots.push(root)
    const serverScript = `
let buffer = ''
let nextRequestId = 100
const pending = new Map()
let clientCapabilities = {}
const echoElicitation = ${JSON.stringify(options.echoElicitation === true)}
const echoStructuredContent = ${JSON.stringify(options.echoStructuredContent !== false)}
const lowercaseElicitationEcho = ${JSON.stringify(options.lowercaseElicitationEcho === true)}
const percentEncodeElicitationEcho = ${JSON.stringify(options.percentEncodeElicitationEcho === true)}
const base64Encoding = ${JSON.stringify(options.base64Encoding ?? null)}
const base64KeyValueEcho = ${JSON.stringify(options.base64KeyValueEcho === true)}
const extraBase64Padding = ${JSON.stringify(options.extraBase64Padding === true)}
function send(message) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\\n') }
process.stdin.setEncoding('utf8')
process.stdin.on('data', chunk => {
  buffer += chunk
  let end
  while ((end = buffer.indexOf('\\n')) >= 0) {
    const line = buffer.slice(0, end); buffer = buffer.slice(end + 1)
    if (!line) continue
    const request = JSON.parse(line)
    if (request.method === 'initialize') {
      clientCapabilities = request.params.capabilities || {}
      send({ id: request.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1.0' } } })
    } else if (request.method === 'tools/list') {
      send({ id: request.id, result: { tools: [{ name: 'collect', description: JSON.stringify(clientCapabilities), inputSchema: { type: 'object', properties: { mode: { type: 'string' }, invalidSchema: { type: 'boolean' } } } }] } })
    } else if (request.method === 'tools/call') {
      const id = nextRequestId++
      const args = request.params.arguments || {}
      const params = args.mode === 'url'
        ? { mode: 'url', elicitationId: 'fixture-1', url: 'https://example.invalid', message: 'Continue on the external page.' }
        : { mode: 'form', message: 'Share a display name and choose a color.', requestedSchema: args.invalidSchema
            ? { type: 'object', properties: { nested: { type: 'object' } } }
            : ${JSON.stringify(options.elicitationSchema ?? formSchema)} }
      pending.set(id, request.id)
      send({ id, method: 'elicitation/create', params })
    } else if (request.id !== undefined && pending.has(request.id)) {
      const toolCallId = pending.get(request.id)
      pending.delete(request.id)
      const action = request.error ? request.error.message : request.result.action
      const echoAccepted = echoElicitation && !request.error && request.result.action === 'accept'
      const echoedContent = echoAccepted
        ? Object.fromEntries(Object.entries(request.result.content).map(([key, value]) => {
            if (typeof value !== 'string' && !base64Encoding) return [key, value]
            const stringValue = typeof value === 'string' ? value : String(value)
            let encoded = percentEncodeElicitationEcho ? encodeURIComponent(stringValue) : stringValue
            if (base64Encoding) {
              const base64 = Buffer.from(stringValue, 'utf8').toString('base64')
              const base64Url = base64.replace(/\\+/g, '-').replace(/\\//g, '_')
              encoded = base64Encoding === 'standard' ? base64
                : base64Encoding === 'url-padded' ? base64Url
                  : base64Url.replace(/=+$/, '')
              if (extraBase64Padding && typeof value === 'number') encoded += '='
            }
            const echoedValue = lowercaseElicitationEcho ? encoded.toLowerCase() : encoded
            return [key, base64KeyValueEcho ? 'count=' + echoedValue : echoedValue]
          }))
        : undefined
      const resultContent = echoAccepted
        ? [{ type: 'text', text: 'echo: ' + JSON.stringify(echoedContent) }]
        : [{ type: 'text', text: String(action) }]
      send({ id: toolCallId, result: {
        content: resultContent,
        ...(echoAccepted && echoStructuredContent ? { structuredContent: { echo: echoedContent } } : {}),
        isError: Boolean(request.error),
      } })
    }
  }
})
`
    await mkdir(join(root, '.deepseek'), { recursive: true })
    await writeFile(join(root, '.deepseek', 'mcp.json'), JSON.stringify({
      servers: { fixture: { transport: 'stdio', command: process.execPath, args: ['-e', serverScript] } },
    }))
    const trustFile = join(root, 'trust.json')
    const loadOptions = { enabled: true, trustFile, initialTimeoutMs: 5_000, ...options }
    const pendingApproval = await loadMcpTools(root, loadOptions)
    await approveMcpConfig(root, pendingApproval.approval!, trustFile)
    return loadMcpTools(root, loadOptions)
  }

  sandboxTest('registers elicitation before connect, advertises only form, and returns all three user choices', async () => {
    const actions = [
      { action: 'accept', content: { displayName: 'Ada', color: 'blue' } },
      { action: 'decline' },
      { action: 'cancel' },
    ] as const
    const requests: unknown[] = []
    let index = 0
    const loaded = await loadElicitationFixture({
      enableFormElicitation: true,
      mcpElicitationHandler: async (request, signal) => {
        expect(signal.aborted).toBe(false)
        requests.push(request)
        return actions[index++]!
      },
    })
    try {
      expect(loaded.errors).toEqual([])
      const tool = loaded.tools[0]!
      const capabilities = JSON.parse(tool.description.replace('[MCP:fixture] ', ''))
      expect(capabilities.elicitation).toEqual({ form: { applyDefaults: true } })
      expect(capabilities.elicitation.url).toBeUndefined()

      for (const action of ['accept', 'decline', 'cancel']) {
        await expect(tool.execute({ mode: 'form' })).resolves.toBe(action)
      }
      expect(requests).toHaveLength(3)
      expect(requests).toEqual(Array(3).fill({
        serverName: 'fixture',
        message: 'Share a display name and choose a color.',
        requestedSchema: formSchema,
      }))
      expect(JSON.stringify(requests)).not.toContain('Ada')
    } finally {
      await loaded.cleanup?.()
    }
  }, 30_000)

  sandboxTest('rejects URL mode and invalid schemas before invoking the UI handler', async () => {
    let handlerCalls = 0
    const loaded = await loadElicitationFixture({
      enableFormElicitation: true,
      mcpElicitationHandler: async () => { handlerCalls++; return { action: 'decline' } },
    })
    try {
      const tool = loaded.tools[0]!
      await expect(tool.execute({ mode: 'url' })).rejects.toThrow(/URL-mode elicitation/)
      await expect(tool.execute({ mode: 'form', invalidSchema: true })).rejects.toThrow()
      expect(handlerCalls).toBe(0)
    } finally {
      await loaded.cleanup?.()
    }
  }, 30_000)

  sandboxTest('fails clearly without a UI handler and never auto-accepts a form', async () => {
    const loaded = await loadElicitationFixture({ enableFormElicitation: true })
    try {
      const tool = loaded.tools[0]!
      const started = Date.now()
      await expect(tool.execute({ mode: 'form' })).rejects.toThrow(/no interactive UI handler/)
      expect(Date.now() - started).toBeLessThan(2_000)
    } finally {
      await loaded.cleanup?.()
    }
  }, 30_000)

  sandboxTest('does not advertise or register elicitation for non-interactive sessions', async () => {
    const loaded = await loadElicitationFixture()
    try {
      const tool = loaded.tools[0]!
      const capabilities = JSON.parse(tool.description.replace('[MCP:fixture] ', ''))
      expect(capabilities.elicitation).toBeUndefined()
      await expect(tool.execute({ mode: 'form' })).rejects.toThrow(/Method not found/)
    } finally {
      await loaded.cleanup?.()
    }
  }, 30_000)

  sandboxTest('redacts string and numeric Base64 echoes from concurrent structured results, agent events, and audit logs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-agent-mcp-elicitation-redaction-'))
    roots.push(root)
    const secrets = ['Ada+tag@example.com', 'Grace+tag@example.com']
    const numericValues = [12345678, 12345679]
    const elicitationSchema: McpElicitationSchema = {
      type: 'object',
      properties: {
        displayName: { type: 'string', minLength: 1, maxLength: 40 },
        age: { type: 'integer' },
        color: { type: 'string', enum: ['green', 'blue'] },
      },
      required: ['displayName', 'color'],
    }
    let responseIndex = 0
    const loaded = await loadElicitationFixture({
      enableFormElicitation: true,
      echoElicitation: true,
      base64Encoding: 'standard',
      base64KeyValueEcho: true,
      extraBase64Padding: true,
      elicitationSchema,
      mcpElicitationHandler: async () => {
        const index = responseIndex++
        return { action: 'accept', content: { displayName: secrets[index]!, age: numericValues[index]!, color: index === 0 ? 'green' : 'blue' } }
      },
    })
    const agent = new Agent({ provider: 'local', localModel: 'fixture' }, {
      projectRoot: root,
      logFile: null,
      snapshotFile: null,
      enableMcpFormElicitation: true,
    })
    const { getLogFile } = await import('../src/agent/auditLog.js')
    const logPath = getLogFile()
    const logBefore = await readFile(logPath, 'utf8').catch(() => '')
    const eventResults: string[] = []
    const callbackResults: string[] = []
    const toolName = loaded.tools[0]!.name
    const unsubscribe = agent.orchestrator.events.subscribe(event => {
      if (event.type === 'tool_finished' && event.payload.tool === toolName) eventResults.push(String(event.payload.result))
    })

    try {
      await agent.readyPromise
      const internal = agent as any
      internal.installMcpTools(loaded.tools)
      internal.settings = { permissions: { allow: ['*'], deny: [] }, risk: { enabled: false } }
      agent.setToolPermissionHandler(async () => 'once')
      const calls = secrets.map((_secret, index) => ({
        id: `mcp-elicitation-redaction-${index}`,
        type: 'function' as const,
        function: { name: toolName, arguments: JSON.stringify({ mode: 'form' }) },
      }))
      const results = await Promise.all(calls.map(call => internal.checkAndExecuteTool(call, { mode: 'form' }, {
        onToken: () => {},
        onToolCall: () => {},
        onToolResult: (_name: string, result: string) => callbackResults.push(result),
        onDone: () => {},
      })))

      expect(results).toHaveLength(2)
      for (const { result } of results) {
        expect(result).toContain('[redacted MCP elicitation value]')
        expect(result).toContain('count=[redacted MCP elicitation value]')
        for (const value of numericValues) {
          expect(result).not.toContain(String(value))
          expect(result).not.toContain(Buffer.from(String(value), 'utf8').toString('base64'))
        }
        expect(result).not.toContain('"color":"green"')
        expect(result).not.toContain('"color":"blue"')
        for (const secret of secrets) {
          expect(result.toLowerCase()).not.toContain(secret.toLowerCase())
          expect(result).not.toContain(Buffer.from(secret, 'utf8').toString('base64'))
        }
      }
      expect(eventResults).toHaveLength(2)
      expect(callbackResults).toHaveLength(2)
      for (const result of [...eventResults, ...callbackResults]) {
        expect(result).toContain('count=[redacted MCP elicitation value]')
        for (const secret of secrets) {
          expect(result.toLowerCase()).not.toContain(secret.toLowerCase())
          expect(result).not.toContain(Buffer.from(secret, 'utf8').toString('base64'))
        }
        for (const value of numericValues) {
          expect(result).not.toContain(String(value))
          expect(result).not.toContain(Buffer.from(String(value), 'utf8').toString('base64'))
        }
      }

      await new Promise(resolve => setTimeout(resolve, 20))
      const auditLog = await readFile(logPath, 'utf8')
      const newEntries = auditLog.slice(logBefore.length).split('\n').filter(Boolean).map(line => JSON.parse(line))
      const toolResults = newEntries.filter(entry => entry.type === 'tool_result' && entry.tool === toolName)
      expect(toolResults).toHaveLength(2)
      for (const entry of toolResults) {
        expect(JSON.stringify(entry)).toContain('count=[redacted MCP elicitation value]')
        for (const secret of secrets) {
          expect(JSON.stringify(entry).toLowerCase()).not.toContain(secret.toLowerCase())
          expect(JSON.stringify(entry)).not.toContain(Buffer.from(secret, 'utf8').toString('base64'))
        }
        for (const value of numericValues) {
          expect(JSON.stringify(entry)).not.toContain(String(value))
          expect(JSON.stringify(entry)).not.toContain(Buffer.from(String(value), 'utf8').toString('base64'))
        }
      }
    } finally {
      unsubscribe()
      await agent.shutdown()
      await loaded.cleanup?.()
    }
  }, 30_000)

  sandboxTest('redacts Base64 key-value echoes from text-only MCP results', async () => {
    const numericValue = 12345678
    const encodedValue = Buffer.from(String(numericValue), 'utf8').toString('base64')
    const loaded = await loadElicitationFixture({
      enableFormElicitation: true,
      echoElicitation: true,
      echoStructuredContent: false,
      base64Encoding: 'standard',
      base64KeyValueEcho: true,
      extraBase64Padding: true,
      elicitationSchema: {
        type: 'object',
        properties: {
          displayName: { type: 'string', minLength: 1, maxLength: 40 },
          age: { type: 'integer', minimum: 0, maximum: 99_999_999 },
          color: { type: 'string', enum: ['blue', 'green'] },
        },
        required: ['displayName', 'color'],
      },
      mcpElicitationHandler: async () => ({
        action: 'accept', content: { displayName: 'Ada', age: numericValue, color: 'blue' },
      }),
    })
    try {
      const output = await loaded.tools[0]!.execute({ mode: 'form' })
      expect(output).toContain('count=[redacted MCP elicitation value]')
      expect(output).not.toContain(encodedValue)
      expect(output).not.toContain(String(numericValue))
    } finally {
      await loaded.cleanup?.()
    }
  }, 30_000)

  sandboxTest('redacts accepted values echoed only in MCP text content', async () => {
    const secret = 'Ada+tag@example.com'
    const encodedSecret = encodeURIComponent(secret).toLowerCase()
    const loaded = await loadElicitationFixture({
      enableFormElicitation: true,
      echoElicitation: true,
      echoStructuredContent: false,
      lowercaseElicitationEcho: true,
      percentEncodeElicitationEcho: true,
      mcpElicitationHandler: async () => ({
        action: 'accept', content: { displayName: secret, age: 51, color: 'blue' },
      }),
    })
    try {
      const output = await loaded.tools[0]!.execute({ mode: 'form' })
      expect(output).toContain('[redacted MCP elicitation value]')
      expect(output).not.toContain(secret)
      expect(output.toLowerCase()).not.toContain(encodedSecret)
    } finally {
      await loaded.cleanup?.()
    }
  }, 30_000)

  sandboxTest('redacts unpadded Base64URL values echoed only in MCP text content', async () => {
    const secret = 'Ada+tag😀@example.com'
    const encodedSecret = Buffer.from(secret, 'utf8').toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    expect(encodedSecret).toBe('QWRhK3RhZ_CfmIBAZXhhbXBsZS5jb20')

    const loaded = await loadElicitationFixture({
      enableFormElicitation: true,
      echoElicitation: true,
      echoStructuredContent: false,
      base64Encoding: 'url-unpadded',
      mcpElicitationHandler: async () => ({
        action: 'accept', content: { displayName: secret, age: 51, color: 'blue' },
      }),
    })
    try {
      const output = await loaded.tools[0]!.execute({ mode: 'form' })
      expect(output).toContain('[redacted MCP elicitation value]')
      expect(output).not.toContain(secret)
      expect(output).not.toContain(encodedSecret)
    } finally {
      await loaded.cleanup?.()
    }
  }, 30_000)
})
