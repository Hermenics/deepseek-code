import { createHash } from 'node:crypto'

export const TOOL_DISCOVERY_VERSION = 'tool_discovery_v1'
export const TOOL_DISCOVERY_MAX_RESULTS = 10
export const TOOL_DISCOVERY_MAX_RESPONSE_BYTES = 20_000

export interface DiscoverableTool {
  name: string
  description: string
  parameters: object
}

export interface ToolDiscoveryResult {
  schema: typeof TOOL_DISCOVERY_VERSION
  catalogFingerprint: string
  catalogSize: number
  query: string
  matches: DiscoverableTool[]
  omitted: number
  refineQuery: boolean
  message?: string
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

function descriptorFingerprint(tools: readonly DiscoverableTool[]): string {
  const descriptors = [...tools].map(tool => ({ name: tool.name, description: tool.description, parameters: tool.parameters }))
    .sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
  return createHash('sha256').update(`${TOOL_DISCOVERY_VERSION}\n${canonical(descriptors)}`).digest('hex')
}

function termsOf(query: string): string[] {
  return [...new Set(query.toLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? [])]
}

function score(tool: DiscoverableTool, terms: string[]): number {
  if (!terms.length) return 0
  const name = tool.name.toLowerCase()
  const description = tool.description.toLowerCase()
  const schema = canonical(tool.parameters).toLowerCase()
  let points = 0
  for (const term of terms) {
    if (name === term) points += 12
    else if (name.includes(term)) points += 8
    if (description.includes(term)) points += 3
    if (schema.includes(term)) points += 1
  }
  return points
}

/** Deterministic, read-only lookup over descriptors already installed by the host. */
export function discoverTools(tools: readonly DiscoverableTool[], query: string): ToolDiscoveryResult {
  const normalizedQuery = query.trim().slice(0, 500)
  const fingerprint = descriptorFingerprint(tools)
  const terms = termsOf(normalizedQuery)
  if (!terms.length) return {
    schema: TOOL_DISCOVERY_VERSION, catalogFingerprint: fingerprint, catalogSize: tools.length,
    query: normalizedQuery, matches: [], omitted: 0, refineQuery: false,
    message: 'Provide a non-empty search query.',
  }

  const ranked = tools.map(tool => ({ tool, score: score(tool, terms) }))
    .filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score || (a.tool.name < b.tool.name ? -1 : a.tool.name > b.tool.name ? 1 : 0))
  const matches: DiscoverableTool[] = []
  let omitted = 0
  for (const { tool } of ranked) {
    if (matches.length >= TOOL_DISCOVERY_MAX_RESULTS) { omitted += 1; continue }
    // Never truncate a JSON schema. If this descriptor cannot fit, count it as omitted and
    // keep searching so a smaller, relevant descriptor may still be returned.
    const candidate = [...matches, tool]
    const candidateOmitted = ranked.length - candidate.length
    const envelope = {
      schema: TOOL_DISCOVERY_VERSION, catalogFingerprint: fingerprint, catalogSize: tools.length,
      query: normalizedQuery, matches: candidate, omitted: candidateOmitted,
      refineQuery: candidateOmitted > 0,
    }
    const candidateBytes = Buffer.byteLength(JSON.stringify(envelope), 'utf8')
    if (candidateBytes > TOOL_DISCOVERY_MAX_RESPONSE_BYTES) { omitted += 1; continue }
    matches.push(tool)
  }
  omitted = ranked.length - matches.length
  const result: ToolDiscoveryResult = {
    schema: TOOL_DISCOVERY_VERSION, catalogFingerprint: fingerprint, catalogSize: tools.length,
    query: normalizedQuery, matches, omitted, refineQuery: omitted > 0,
    ...(omitted > 0 ? { message: 'Some matching tools were omitted to keep complete schemas within the response limit; refine the query.' } : {}),
  }
  // The message field is optional overhead. Keep the advertised bound true even at the boundary.
  while (Buffer.byteLength(JSON.stringify(result), 'utf8') > TOOL_DISCOVERY_MAX_RESPONSE_BYTES && result.matches.length) {
    result.matches.pop()
    result.omitted = ranked.length - result.matches.length
    result.refineQuery = true
  }
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > TOOL_DISCOVERY_MAX_RESPONSE_BYTES) {
    result.matches = []
    result.omitted = ranked.length
    result.refineQuery = ranked.length > 0
    result.message = 'Matching schemas exceed the response limit; refine the query.'
  }
  return result
}

export function createToolDiscovery(tools: readonly DiscoverableTool[]): (query: string) => string {
  // Freeze a descriptor snapshot for the lifetime of this callback; MCP reload installs a new callback.
  const snapshot = structuredClone(tools)
  return query => JSON.stringify(discoverTools(snapshot, query))
}
