import { expect, it } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { matchRoute } from '../src/router'

it('matches routes with several parameters', () => {
  expect(matchRoute('/orgs/acme/repos/site')).toEqual({ name: 'repo', params: { org: 'acme', repo: 'site' } })
  expect(matchRoute('/orgs/acme/repos/site/blob/main')).toEqual({ name: 'file', params: { org: 'acme', repo: 'site', ref: 'main' } })
  expect(matchRoute('/users/7/posts')).toEqual({ name: 'userPosts', params: { id: '7' } })
})

it('fixes the generator, so regenerating reproduces the committed file', () => {
  const out = join(mkdtempSync(join(tmpdir(), 'gen-')), 'routes.ts')
  const gen = spawnSync('bun', ['scripts/gen-routes.ts', out], { encoding: 'utf8' })
  expect(gen.status).toBe(0)
  expect(readFileSync('src/generated/routes.ts', 'utf8')).toBe(readFileSync(out, 'utf8'))
})

it('keeps routes.json as the source of truth', () => {
  const specs = JSON.parse(readFileSync('routes.json', 'utf8')) as Array<{ path: string }>
  expect(specs.map((s) => s.path)).toEqual(['/', '/users/:id', '/users/:id/posts', '/orgs/:org/repos/:repo', '/orgs/:org/repos/:repo/blob/:ref'])
})
