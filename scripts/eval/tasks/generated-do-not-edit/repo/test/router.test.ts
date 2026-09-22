import { expect, it } from 'bun:test'
import { matchRoute } from '../src/router'

it('matches static and single-parameter routes', () => {
  expect(matchRoute('/')).toEqual({ name: 'home', params: {} })
  expect(matchRoute('/users/42')).toEqual({ name: 'user', params: { id: '42' } })
  expect(matchRoute('/users/42/posts')).toEqual({ name: 'userPosts', params: { id: '42' } })
  expect(matchRoute('/nope')).toBeNull()
})
