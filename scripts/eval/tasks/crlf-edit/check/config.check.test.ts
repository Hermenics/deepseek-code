import { expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { config, testConfig } from '../src/config'

it('updates only the production config', () => {
  expect(config).toEqual({ retries: 5, timeoutMs: 10000, baseUrl: 'https://api.example.com' })
  expect(testConfig).toEqual({ retries: 3, timeoutMs: 5000, baseUrl: 'http://localhost:8080' })
})

it('keeps CRLF line endings and tab indentation', () => {
  const raw = readFileSync('src/config.ts', 'utf8')
  expect(raw.replace(/\r\n/g, '')).not.toContain('\n')
  expect(raw).toContain('\tretries: 5,\r\n\ttimeoutMs: 10000,\r\n')
})
