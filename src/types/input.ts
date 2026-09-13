export type PromptImageMediaType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'

export interface PromptImage {
  mediaType: PromptImageMediaType
  data: string
}

export interface PromptInput {
  text: string
  images?: PromptImage[]
}
