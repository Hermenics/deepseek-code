export type CatalogKind = 'MCP' | 'Plugin' | 'Skill'

export interface CatalogEntry {
  id: string
  kind: CatalogKind
  name: string
  source: string
  description: string
}

// ponytail: static, reviewable recommendations; add remote discovery only with a maintained registry.
export const CURATED_CATALOG: CatalogEntry[] = [
  { id: 'github', kind: 'MCP', name: 'GitHub', source: 'github/github-mcp-server', description: 'Repository, issue and pull-request context.' },
  { id: 'playwright', kind: 'MCP', name: 'Playwright', source: 'microsoft/playwright-mcp', description: 'Browser automation and UI verification.' },
  { id: 'context7', kind: 'MCP', name: 'Context7', source: 'upstash/context7', description: 'Current library documentation for implementation work.' },
  { id: 'openai-docs', kind: 'Skill', name: 'OpenAI docs', source: 'openai/openai-docs', description: 'Official OpenAI product and API research workflow.' },
]

export function formatCatalog(kind?: CatalogKind): string {
  const entries = kind ? CURATED_CATALOG.filter(entry => entry.kind === kind) : CURATED_CATALOG
  const lines = ['Curated integrations (review source and permissions before installing):', '']
  for (const entry of entries) lines.push(`- ${entry.kind} · ${entry.name} — ${entry.description}\n  ${entry.source}`)
  lines.push('', 'MCP entries belong in .deepseek/mcp.json. Skills/plugins can be managed with /skill and /plugin.')
  return lines.join('\n')
}
