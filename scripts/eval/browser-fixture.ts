/**
 * Fixture web server for browser eval tasks. A task's `serve.ts` calls `serveFixture` with its
 * per-run random state and API routes; files are read from the task repo on every request, so the
 * agent's edits show up on reload like a dev server. It prints `READY <url>` for run.ts and writes
 * the state (including the expected `answer`) to EVAL_STATE, outside the agent's workspace.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'

const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json' }

export type Route = (request: Request, url: URL) => Response | Promise<Response> | undefined

/** Random integer in [min, max]. */
export function randomInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1))
}

export async function serveFixture(state: Record<string, string>, routes: Record<string, Route> = {}): Promise<void> {
  const repo = process.env.EVAL_REPO
  const statePath = process.env.EVAL_STATE
  if (!repo || !statePath) throw new Error('serve.ts runs under scripts/eval/run.ts (EVAL_REPO and EVAL_STATE are missing)')
  await writeFile(statePath, JSON.stringify(state))
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      const route = routes[`${request.method} ${url.pathname}`] ?? routes[url.pathname]
      const routed = route ? await route(request, url) : undefined
      if (routed) return routed
      const relative = normalize(url.pathname === '/' ? '/public/index.html' : url.pathname).replace(/^(\.\.[/\\])+/, '')
      try {
        const body = await readFile(join(repo, relative))
        return new Response(body, { headers: { 'content-type': TYPES[extname(relative)] ?? 'application/octet-stream', 'cache-control': 'no-store' } })
      } catch {
        return new Response('Not found', { status: 404 })
      }
    },
  })
  console.log(`READY http://localhost:${server.port}/`)
}
