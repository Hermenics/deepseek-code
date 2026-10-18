import { expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { findExecutableTestCallbacks, structuralTestBodyText } from './testEvidence.js'
import { parseIni } from '../src/ini'

function testCallbacks() {
  const sources = readdirSync('.', { recursive: true }).map(String)
    .filter((file) => /\.(test|spec)\.[jt]sx?$/.test(file) && !file.includes('__eval_check__') && !file.includes('node_modules'))
    .map((fileName) => ({ fileName, text: readFileSync(fileName, 'utf8') }))
  return findExecutableTestCallbacks(sources)
}

it('parses sections, root keys, comments, quotes, inline comments and merges', () => {
  const text = `; top comment
name = root app
[server]
host = localhost ; dev only
port=8080
url = http://x.io/?a=1#frag
[ paths ]
  # indented comment
home = "/home/me ; not a comment"
quote = "say \\"hi\\" \\\\ ok"
[server]
port = 9090
`
  expect(parseIni(text)).toEqual({
    '': { name: 'root app' },
    server: { host: 'localhost', port: '9090', url: 'http://x.io/?a=1#frag' },
    paths: { home: '/home/me ; not a comment', quote: 'say "hi" \\ ok' },
  })
})

it('handles CRLF, empty sections and omits an empty root section', () => {
  const result = parseIni('[a]\r\nk = v = w\r\n\r\n[empty]\r\n')
  expect(result).toEqual({ a: { k: 'v = w' }, empty: {} })
  expect(Object.keys(result)).not.toContain('')
})

it('reports the 1-based line number of an invalid line', () => {
  expect(() => parseIni('[a]\nk = v\njust some words')).toThrow('Invalid line 3')
})

it('adds tests', () => {
  expect(testCallbacks().some((callback) => {
    const body = structuralTestBodyText(callback)
    return /\bparseIni\s*\(/.test(body)
      && /\bexpect\s*\(/.test(body)
      && /\.(?:toEqual|toMatchObject|toThrow|toBe|toContain)\s*\(/.test(body)
  })).toBe(true)
})
