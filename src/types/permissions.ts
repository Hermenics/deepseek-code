export type ToolPermissionResult = 'once' | 'session' | 'deny'

export type ToolPermissionHandler = (
  toolName: string,
  args: object,
) => Promise<ToolPermissionResult>
