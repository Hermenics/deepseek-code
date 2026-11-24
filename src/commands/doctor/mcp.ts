import { loadMcpTools, type McpLoadOptions } from '../../agent/mcp.js'

export interface McpDoctorCheck {
  name: 'MCP catalog'
  ok: boolean
  detail: string
}

/** Lists tools only from already-approved MCP configurations. This diagnostic never calls a tool. */
export async function checkMcpCatalog(
  cwd: string,
  enabled: boolean,
  options: Pick<McpLoadOptions, 'trustFile' | 'initialTimeoutMs'> = {},
): Promise<McpDoctorCheck> {
  if (!enabled) return { name: 'MCP catalog', ok: true, detail: 'MCP is disabled; no servers were started' }

  let loaded: Awaited<ReturnType<typeof loadMcpTools>> | undefined
  try {
    loaded = await loadMcpTools(cwd, { enabled: true, eager: true, ...options })
    const pendingApproval = loaded.approval !== undefined
    const failed = loaded.errors.length > 0
    const parts = [`${loaded.tools.length} tool${loaded.tools.length === 1 ? '' : 's'} listed from approved MCP configurations`]
    if (pendingApproval) parts.push('unapproved configuration skipped')
    if (failed) parts.push(`${loaded.errors.length} approved server or configuration check${loaded.errors.length === 1 ? '' : 's'} failed`)
    if (loaded.warnings?.length) parts.push(`${loaded.warnings.length} optional schema-cache notice${loaded.warnings.length === 1 ? '' : 's'}`)
    return { name: 'MCP catalog', ok: !pendingApproval && !failed, detail: parts.join('; ') }
  } catch {
    return { name: 'MCP catalog', ok: false, detail: 'approved MCP configurations could not be inspected' }
  } finally {
    await loaded?.cleanup?.()
  }
}
