export interface CompiledRoute {
  name: string
  pattern: RegExp
  params: string[]
}

export interface RouteMatch {
  name: string
  params: Record<string, string>
}
