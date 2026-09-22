import { ROUTES } from './generated/routes'
import type { RouteMatch } from './types'

export function matchRoute(path: string): RouteMatch | null {
  for (const route of ROUTES) {
    const match = route.pattern.exec(path)
    if (!match) continue
    const params = Object.fromEntries(route.params.map((name, i) => [name, decodeURIComponent(match[i + 1]!)]))
    return { name: route.name, params }
  }
  return null
}
