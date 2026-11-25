import type { Tool } from '../types.js'

/** Read-only lookup over the host's already installed native and MCP tool descriptors. */
export const DiscoverTools: Tool = {
  name: 'discover_tools',
  description: 'Refresh the approved MCP tool catalog when needed, then search installed tools by name, purpose, or input fields. Returns complete schemas for up to 10 matches; refine the query when results are omitted. This can connect to approved MCP servers but never calls their tools.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', minLength: 1, maxLength: 500, description: 'Terms describing the capability or parameter you need.' },
    },
    required: ['query'],
    additionalProperties: false,
  },
  async execute(args, context) {
    const query = typeof args.query === 'string' ? args.query : ''
    const discoveryContext = context
    if (!discoveryContext?.discoverTools) return JSON.stringify({ error: 'Installed tool discovery is unavailable in this execution context.' })
    await discoveryContext.refreshMcpCatalog?.()
    return discoveryContext.discoverTools(query)
  },
}
