import { expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { parseIni } from '../src/ini'

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
  const files = readdirSync('.', { recursive: true }).map(String).filter((f) => /\.test\.ts$/.test(f) && !f.includes('__eval_check__'))
  expect(files.some((f) => readFileSync(f, 'utf8').includes('parseIni'))).toBe(true)
})
