import type { ToolPermissionResult } from '../types/permissions.js'

export type { ToolPermissionResult }

// Hook placeholder — will be connected to the permission UI system
// For now, provides the type contract for tool permission handling
export function createToolPermissionHandler(
  onRequest: (toolName: string, args: object) => Promise<ToolPermissionResult>
) {
  return onRequest
}
