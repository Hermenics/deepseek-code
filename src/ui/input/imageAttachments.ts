import type { PromptImage } from '../../types/input.js'

const IMAGE_PLACEHOLDER_RE = /\[Image #(\d+)\]/g

/** Keeps only images whose inline placeholders survived editing. */
export function prepareImagePrompt(text: string, images: PromptImage[]): { text: string; images: PromptImage[] } {
  if (images.length === 0) return { text, images: [] }

  const selected: PromptImage[] = []
  const remapped = new Map<number, number>()
  const preparedText = text.replace(IMAGE_PLACEHOLDER_RE, (match, rawIndex: string) => {
    const originalIndex = Number(rawIndex) - 1
    const image = images[originalIndex]
    if (!image) return match
    let preparedIndex = remapped.get(originalIndex)
    if (preparedIndex === undefined) {
      preparedIndex = selected.length
      remapped.set(originalIndex, preparedIndex)
      selected.push(image)
    }
    return `[Image #${preparedIndex + 1}]`
  })
  return { text: preparedText, images: selected }
}
