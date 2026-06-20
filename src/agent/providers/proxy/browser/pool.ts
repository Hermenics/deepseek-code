import { randomUUID } from 'node:crypto'
import type { Page } from 'playwright'
import type { PooledPage } from '../types/index.js'
import { getContext } from './playwright.js'

type Resolver = (page: PooledPage) => void

export class PagePool {
  private pages: PooledPage[] = []
  private queue: Resolver[] = []
  private maxSize: number

  constructor(maxSize: number) {
    this.maxSize = maxSize
  }

  async init(): Promise<void> {
    const ctx = getContext()
    if (!ctx) throw new Error('Browser not initialized. Call initPlaywright() first.')
    for (let i = 0; i < this.maxSize; i++) {
      const page = await ctx.newPage()
      this.pages.push({ id: randomUUID(), busy: false, page, createdAt: Date.now() })
    }
  }

  async warmup(): Promise<void> {
    await Promise.all(this.pages.map(async (p) => {
      try {
        await p.page.goto('https://chat.deepseek.com/', { waitUntil: 'domcontentloaded', timeout: 20000 })
      } catch {}
    }))
  }

  async acquireById(pageId: string): Promise<PooledPage | null> {
    const pooled = this.pages.find((p) => p.id === pageId && !p.busy)
    if (!pooled) return null
    pooled.busy = true
    return pooled
  }

  async acquire(): Promise<PooledPage> {
    const free = this.pages.find((p) => !p.busy)
    if (free) {
      free.busy = true
      return free
    }
    return new Promise<PooledPage>((resolve) => this.queue.push(resolve))
  }

  release(pageId: string): void {
    const pooled = this.pages.find((p) => p.id === pageId)
    if (!pooled) return
    pooled.busy = false
    const next = this.queue.shift()
    if (next) {
      pooled.busy = true
      next(pooled)
    }
  }

  async replacePage(pageId: string): Promise<void> {
    const idx = this.pages.findIndex((p) => p.id === pageId)
    if (idx === -1) return
    try { await this.pages[idx].page.close() } catch {}
    const ctx = getContext()
    if (!ctx) throw new Error('Browser not initialized. Call initPlaywright() first.')
    if (!ctx) throw new Error('Browser not initialized. Call initPlaywright() first.')
    const page = await ctx.newPage()
    this.pages[idx] = { id: randomUUID(), busy: false, page, createdAt: Date.now() }
  }

  async destroy(): Promise<void> {
    for (const p of this.pages) {
      try { await p.page.close() } catch {}
    }
    this.pages = []
  }
}
