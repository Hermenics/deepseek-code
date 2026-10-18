import { expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

interface Fact {
  key: string
  value: unknown
  source: string
  status: string
}

interface Memory {
  project: string
  facts: Fact[]
}

it('selects the current project port and supersedes the old value', () => {
  const historicalNote = readFileSync(new URL('../memory/sessions/01-port.md', import.meta.url), 'utf8')
  const updateNote = readFileSync(new URL('../memory/sessions/02-port-move.md', import.meta.url), 'utf8')
  const otherProjectNote = readFileSync(new URL('../memory/other-projects/paperkite.md', import.meta.url), 'utf8')
  const memory = JSON.parse(readFileSync(new URL('../memory/current-facts.json', import.meta.url), 'utf8')) as Memory
  expect(historicalNote).toContain('`deepseek-code` development web service used port 3000')
  expect(updateNote).toContain('`deepseek-code` development web service moved from port 3000 to port 4100')
  expect(updateNote).toContain('Port 4100 is the current port.')
  expect(otherProjectNote).toContain('`paperkite` analytics service uses port 4800')
  expect(memory).toEqual({
    project: 'deepseek-code',
    facts: [
      { key: 'web_port', value: 3000, source: 'sessions/01-port.md', status: 'superseded' },
      { key: 'web_port', value: 4100, source: 'sessions/02-port-move.md', status: 'current' },
    ],
  } satisfies Memory)
})

it('answers the current port and abstains on missing or cross-project facts', () => {
  const answers = JSON.parse(readFileSync(new URL('../answers.json', import.meta.url), 'utf8')) as Record<string, unknown>
  expect(answers).toEqual({ web_port: 4100, analytics_port: null, deployment_region: null })
  expect(JSON.stringify(answers)).not.toContain('4800')
  expect(readFileSync(new URL('../memory/other-projects/paperkite.md', import.meta.url), 'utf8')).toContain('port 4800')
})
