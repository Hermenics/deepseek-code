import { expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import ts from 'typescript'
import { findExecutableTestCallbacks, structuralTestBodyText } from './testEvidence.js'
import { TaskStore } from '../src/store'
import { formatTask } from '../src/format'

it('defaults priority to normal', () => {
  expect((new TaskStore().add('a') as { priority?: string }).priority).toBe('normal')
})

it('lists by priority, stable within the same priority', () => {
  const store = new TaskStore()
  const add = store.add.bind(store) as (title: string, priority?: string) => unknown
  add('n1')
  add('l1', 'low')
  add('h1', 'high')
  add('n2')
  add('h2', 'high')
  expect(store.list().map((t) => t.title)).toEqual(['h1', 'h2', 'n1', 'n2', 'l1'])
})

it('prefixes only high-priority tasks', () => {
  const format = formatTask as (task: object) => string
  expect(format({ id: 1, title: 'Pay rent', done: false, priority: 'high' })).toBe('! [ ] Pay rent')
  expect(format({ id: 2, title: 'Read', done: true, priority: 'low' })).toBe('[x] Read')
  expect(format({ id: 3, title: 'Walk', done: false, priority: 'normal' })).toBe('[ ] Walk')
})

function testCallbacks() {
  const sources = readdirSync('.', { recursive: true }).map(String)
    .filter((file) => /\.(test|spec)\.[jt]sx?$/.test(file) && !file.includes('__eval_check__') && !file.includes('node_modules'))
    .map((fileName) => ({ fileName, text: readFileSync(fileName, 'utf8') }))
  return findExecutableTestCallbacks(sources)
}

function hasHighPriorityLiteral(callback: ReturnType<typeof findExecutableTestCallbacks>[number]): boolean {
  let found = false
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteralLike(node) && node.text === 'high') found = true
    ts.forEachChild(node, visit)
  }
  visit(callback.body)
  const body = structuralTestBodyText(callback)
  return found && /\bexpect\s*\(/.test(body) && /(?:priority|\.list\s*\(|formatTask)/.test(body)
}

it('adds tests covering priorities', () => {
  expect(testCallbacks().some(hasHighPriorityLiteral)).toBe(true)
})
