// Bun text imports — allows `import text from './file.md' with { type: 'text' }`
declare module '*.md' {
  const content: string
  export default content
}

// code-excerpt: package uses `exports` without types conditional, so moduleResolution: bundler can't find types
declare module 'code-excerpt' {
  export interface CodeExcerpt {
    line: number
    value: string
  }
  declare const codeExcerpt: (
    source: string,
    line: number,
    options?: { around?: number }
  ) => CodeExcerpt[] | undefined
  export default codeExcerpt
}
