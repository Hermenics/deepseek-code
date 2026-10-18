export interface WriteRecord {
  id: string
  operationId: string
  value: string
}

export interface WriteTool {
  write(input: { operationId: string; value: string; idempotencyKey?: string }): Promise<{ id: string }>
  findByOperationId(operationId: string): Promise<WriteRecord | null>
}

export async function createExactlyOnce(tool: WriteTool, operationId: string, value: string): Promise<string> {
  try {
    return (await tool.write({ operationId, value })).id
  } catch {
    return (await tool.write({ operationId, value })).id
  }
}
