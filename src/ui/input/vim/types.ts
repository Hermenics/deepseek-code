export type VimMode = 'insert' | 'normal' | 'operator-pending'

export type Operator = 'd' | 'c' | 'y'

export interface VimState {
  mode: VimMode
  pendingOperator?: Operator | null
  register?: string
  count?: number | null
  pendingKey?: string | null
  textObjectModifier?: 'i' | 'a' | null
}

export interface VimAction {
  type: 'motion' | 'operator' | 'textObject' | 'command' | 'insert'
  motion?: (text: string, cursor: number) => [number, number]
  operator?: Operator
  textObject?: (text: string, cursor: number) => [number, number]
  command?: (text: string, cursor: number) => { text: string; cursor: number }
  enterInsert?: boolean
  insertAt?: 'before' | 'after' | 'lineStart' | 'lineEnd'
}
