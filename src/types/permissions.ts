export type ToolPermissionResult = 'once' | 'session' | 'directory' | 'always' | 'deny' | 'reject'

export type ToolPermissionHandler = (
  toolName: string,
  args: object,
) => Promise<ToolPermissionResult>
