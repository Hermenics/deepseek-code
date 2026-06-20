export interface Tool {
  name: string
  description: string
  parameters: object
  execute(args: Record<string, unknown>): Promise<string>
}
