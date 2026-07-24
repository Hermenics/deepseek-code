export type ToolPermissionResult = 'once' | 'session' | 'directory' | 'always' | 'deny'

export type ToolPermissionHandler = (
  toolName: string,
  args: object,
) => Promise<ToolPermissionResult>
