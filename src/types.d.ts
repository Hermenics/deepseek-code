// Bun text imports — allows `import text from './file.md' with { type: 'text' }`
declare module '*.md' {
  const content: string
  export default content
}
