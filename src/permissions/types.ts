export type PermissionBehavior = 'allow' | 'deny' | 'ask'

export interface PermissionRule {
  raw: string          // original string e.g. "Shell(git *)"
  toolName: string     // normalized tool name e.g. "shell"
  pattern?: string     // content pattern e.g. "git *" (undefined = matches all uses)
}

export type PermissionDecision = 'allow' | 'deny' | 'ask'
