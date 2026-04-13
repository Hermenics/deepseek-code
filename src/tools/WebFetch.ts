import { Tool } from './types.js'

export const WebFetch: Tool = {
  name: 'web_fetch',
  description: 'Fetch content from a URL. Returns the page text.',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'URL to fetch' },
    },
    required: ['url'],
  },
  async execute(args) {
    const res = await fetch(args.url as string)
    const text = await res.text()
    // Strip HTML tags for readability
    const clean = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    return clean.slice(0, 20000)
  },
}
