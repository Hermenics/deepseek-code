import type { Page } from 'playwright'

export interface ProxyConfig {
  proxyApiKey: string
  rateLimit: number
  cacheTtl: number
  poolSize: number
  responseTimeout: number
  port: number
  host: string
  logLevel: 'debug' | 'info' | 'warn' | 'error'
  corsOrigins: string
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ProxyRequest {
  model: string
  messages: ChatMessage[]
  stream: boolean
  conversationId?: string
}

export interface PooledPage {
  id: string
  busy: boolean
  page: Page
  createdAt: number
}

export interface Session {
  conversationId: string
  pageId: string
  threadUrl: string
  createdAt: number
}

export interface TokenEvent {
  token: string
  done: boolean
  error?: string
  thinking?: string
}

export interface CacheEntry {
  response: string
  model: string
  createdAt: number
}

export interface HistoryEntry {
  timestamp: string
  model: string
  conversationId: string
  messages: ChatMessage[]
  response: string
}
