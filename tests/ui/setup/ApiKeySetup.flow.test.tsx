import { afterEach, expect, test } from 'bun:test'
import React from 'react'
import { PassThrough } from 'node:stream'
import { renderSync } from '../../../src/ink/root.js'
import { ApiKeySetup, type ProviderConfig } from '../../../src/ui/setup/ApiKeySetup.js'

class FakeTerminal extends PassThrough {
  isTTY = true
  isRaw = false
  columns = 100
  rows = 30
  setRawMode(enabled: boolean): this { this.isRaw = enabled; return this }
  ref(): this { return this }
  unref(): this { return this }
}

const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch })

/** Renders the setup, answers the official check with `officialApi`, and submits a key; nothing here reaches the save step. */
async function submitKey(officialApi: () => Promise<Response>) {
  globalThis.fetch = officialApi as unknown as typeof fetch
  const stdin = new FakeTerminal()
  const stdout = new FakeTerminal()
  let screen = ''
  stdout.on('data', chunk => { screen += chunk.toString() })
  const instance = renderSync(<ApiKeySetup onDone={() => { throw new Error('setup must not finish here') }} />, {
    stdin: stdin as unknown as NodeJS.ReadStream,
    stdout: stdout as unknown as NodeJS.WriteStream,
    stderr: stdout as unknown as NodeJS.WriteStream,
    exitOnCtrlC: false,
    patchConsole: false,
  })
  const press = async (input: string) => { stdin.write(input); await Bun.sleep(40) }
  await Bun.sleep(80)
  await press('\r') // theme
  await press('\r') // DeepSeek API
  await press('sk-gateway-key')
  screen = ''
  await press('\r')
  await Bun.sleep(80)
  return {
    // Ink redraws only the cells that changed, so compare words new to each state, without spaces.
    screen: () => screen.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\s+/g, ''),
    reset: () => { screen = '' },
    press,
    close: () => { stdout.isTTY = false; instance.unmount(); instance.cleanup() },
  }
}

async function submitProvider(
  providerIndex: number,
  fields: string[],
  probeProvider: (config: ProviderConfig) => Promise<string[]>,
) {
  const stdin = new FakeTerminal()
  const stdout = new FakeTerminal()
  let screen = ''
  const instance = renderSync(<ApiKeySetup
    onDone={() => { throw new Error('setup must not finish without an available model') }}
    probeProvider={probeProvider}
  />, {
    stdin: stdin as unknown as NodeJS.ReadStream,
    stdout: stdout as unknown as NodeJS.WriteStream,
    stderr: stdout as unknown as NodeJS.WriteStream,
    exitOnCtrlC: false,
    patchConsole: false,
  })
  stdout.on('data', chunk => { screen += chunk.toString() })
  const press = async (input: string) => { stdin.write(input); await Bun.sleep(40) }
  await Bun.sleep(80)
  await press('\r') // theme
  for (let i = 0; i < providerIndex; i++) await press('\x1b[B')
  await press('\r') // provider
  for (const field of fields) {
    await press(field)
    await press('\r')
  }
  await Bun.sleep(80)
  return {
    screen: () => screen.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\s+/g, ''),
    close: () => { stdout.isTTY = false; instance.unmount(); instance.cleanup() },
  }
}

test('a key the official API rejects leads to a required base URL instead of blocking', async () => {
  const setup = await submitKey(async () => new Response('{}', { status: 401 }))
  try {
    expect(setup.screen()).toContain('BaseURL')
    expect(setup.screen()).toContain('gateway')
    expect(setup.screen()).not.toContain('optional')
    setup.reset()
    await setup.press('\r') // empty base URL
    expect(setup.screen()).toContain('gatewaythiskeybelongsto')
  } finally { setup.close() }
})

test('an unreachable official API offers an optional base URL', async () => {
  const setup = await submitKey(async () => { throw new TypeError('fetch failed') })
  try {
    expect(setup.screen()).toContain('couldnotbereached')
    expect(setup.screen()).toContain('optional')
  } finally { setup.close() }
})

for (const testCase of [
  { provider: 'bedrock', index: 1, fields: ['us-east-1', 'fixture-profile'], expected: { provider: 'bedrock', awsRegion: 'us-east-1', awsProfile: 'fixture-profile' } },
  { provider: 'vertex', index: 2, fields: ['fixture-project', 'us-central1', '/fixture/service-account.json'], expected: { provider: 'vertex', gcpProject: 'fixture-project', gcpLocation: 'us-central1', gcpCredentials: '/fixture/service-account.json' } },
  { provider: 'local', index: 3, fields: ['http://127.0.0.1:11434/v1', 'fixture-model'], expected: { provider: 'local', localBaseUrl: 'http://127.0.0.1:11434/v1', localModel: 'fixture-model' } },
]) {
  test(`${testCase.provider} setup does not finish when its model catalog is empty`, async () => {
    const checked: ProviderConfig[] = []
    const setup = await submitProvider(testCase.index, testCase.fields, async config => {
      checked.push(config)
      return []
    })
    try {
      expect(checked).toHaveLength(1)
      expect(checked[0]).toMatchObject(testCase.expected)
      expect(setup.screen().toLowerCase()).toContain('nomodelswerereturnedby')
    } finally { setup.close() }
  })
}

test('local setup does not finish when its configured model is missing from the model catalog', async () => {
  const setup = await submitProvider(3, ['http://127.0.0.1:11434/v1', 'fixture-model'], async () => ['another-model'])
  try {
    expect(setup.screen().toLowerCase()).toContain('configuredlocalmodel')
  } finally { setup.close() }
})

test('provider setup labels its check as model-catalog connectivity', async () => {
  const setup = await submitProvider(1, ['us-east-1', 'fixture-profile'], () => new Promise(() => {}))
  try {
    expect(setup.screen().toLowerCase()).toContain('catalogconnectivity')
    expect(setup.screen().toLowerCase()).not.toContain('inferencepermission')
  } finally { setup.close() }
})
