import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execa } from 'execa'
import type { ToolExecutionContext } from '../src/orchestration/types.js'
import { validateSchema } from '../src/orchestration/schema.js'
import { Grep } from '../src/tools/Grep/Grep.js'
import { scrubbedEnv } from '../src/utils/platform.js'

let workspace: string | undefined
let isolatedHome: string | undefined

afterEach(async () => {
  if (workspace) await rm(workspace, { recursive: true, force: true })
  if (isolatedHome) await rm(isolatedHome, { recursive: true, force: true })
  workspace = undefined
  isolatedHome = undefined
})

test('grep returns bounded pages with a query-bound continuation cursor', async () => {
  workspace = await mkdtemp(join(tmpdir(), 'deepseek-grep-pages-'))
  await writeFile(join(workspace, 'matches.ts'), Array.from({ length: 5 }, (_, index) => `needle ${index + 1}`).join('\n'))
  await writeFile(join(workspace, 'other.ts'), 'needle A\nneedle B')
  const context = {
    workspacePath: workspace, projectRoot: workspace,
    permissionProfile: 'researcher-readonly',
  } as ToolExecutionContext

  const complete = await Grep.execute({ pattern: 'needle', path: workspace }, context)
  expect(complete).toContain('matches.ts\n  1:needle 1')
  expect(complete).toContain('  2:needle 2')
  expect(complete).toContain('  5:needle 5')
  expect(complete).toContain('other.ts\n  1:needle A\n  2:needle B')

  const first = await Grep.execute({ pattern: 'needle', path: workspace, limit: 2 }, context)
  expect(first).toContain('matches.ts\n  1:needle 1')
  expect(first).toContain('  2:needle 2')
  expect(first).not.toContain('needle 3')
  const firstCursor = first.match(/Continue with grep cursor=([a-f0-9-]+)/)?.[1]
  expect(firstCursor).toBeTruthy()

  const groupingMismatch = await Grep.execute({ pattern: 'needle', path: workspace, limit: 2, group_by: 'symbol', cursor: firstCursor }, context)
  expect(groupingMismatch).toContain('does not match the original search')

  const next = await Grep.execute({ pattern: 'needle', path: workspace, limit: 2, cursor: firstCursor }, context)
  expect(next).toContain('matches.ts\n  3:needle 3')
  expect(next).toContain('  4:needle 4')
  expect(next).not.toContain('needle 5')
  const nextCursor = next.match(/Continue with grep cursor=([a-f0-9-]+)/)?.[1]
  expect(nextCursor).toBeTruthy()

  const tail = await Grep.execute({ pattern: 'needle', path: workspace, limit: 2, cursor: nextCursor }, context)
  expect(tail).toContain('matches.ts\n  5:needle 5')
  expect(tail).toContain('other.ts\n  1:needle A')
  const tailCursor = tail.match(/Continue with grep cursor=([a-f0-9-]+)/)?.[1]
  expect(tailCursor).toBeTruthy()

  const last = await Grep.execute({ pattern: 'needle', path: workspace, limit: 2, cursor: tailCursor }, context)
  expect(last).toContain('other.ts\n  2:needle B')
  expect(last).not.toContain('offset=')
})

test('grep returns a typed error for one invalid pattern', async () => {
  workspace = await mkdtemp(join(tmpdir(), 'deepseek-grep-invalid-pattern-'))
  await writeFile(join(workspace, 'source.ts'), 'needle\n')
  const context = {
    workspacePath: workspace, projectRoot: workspace,
    permissionProfile: 'researcher-readonly',
  } as ToolExecutionContext

  const result = JSON.parse(await Grep.execute({ pattern: '[', path: workspace }, context))
  expect(result).toMatchObject({
    schemaVersion: 1,
    status: 'error',
    error: { kind: 'tool', code: 'GREP_FAILED', retryable: false },
  })
})

test('grep pattern batches preserve successful output and type failed patterns', async () => {
  workspace = await mkdtemp(join(tmpdir(), 'deepseek-grep-pattern-batch-'))
  await writeFile(join(workspace, 'source.ts'), 'needle\n')
  const context = {
    workspacePath: workspace, projectRoot: workspace,
    permissionProfile: 'researcher-readonly',
  } as ToolExecutionContext

  const result = JSON.parse(await Grep.execute({ patterns: ['needle', '['], path: workspace }, context))
  expect(result).toMatchObject({
    schemaVersion: 1,
    status: 'partial',
    error: { kind: 'tool', code: 'GREP_PATTERNS_PARTIAL', retryable: false },
    partial: {
      results: [
        { pattern: 'needle', status: 'done' },
        { pattern: '[', status: 'error', result: { error: { code: 'GREP_FAILED' } } },
      ],
    },
  })
  expect(result.partial.results[0].output).toContain('1:needle')
})

test('grep schema enforces non-empty exclusive pattern forms, batch limits, and cursor compatibility', () => {
  expect(validateSchema(Grep.parameters, { pattern: '' }).valid).toBe(false)
  expect(validateSchema(Grep.parameters, { pattern: 'needle', patterns: ['other'] }).valid).toBe(false)
  expect(validateSchema(Grep.parameters, { patterns: [] }).valid).toBe(false)
  expect(validateSchema(Grep.parameters, { patterns: [''] }).valid).toBe(false)
  expect(validateSchema(Grep.parameters, { patterns: ['needle'], cursor: 'cursor-token' }).valid).toBe(false)
  expect(validateSchema(Grep.parameters, { patterns: Array.from({ length: 26 }, () => 'needle') }).valid).toBe(false)
  expect(validateSchema(Grep.parameters, { pattern: 'needle' }).valid).toBe(true)
  expect(validateSchema(Grep.parameters, { pattern: 'needle', cursor: 'cursor-token' }).valid).toBe(true)
  expect(validateSchema(Grep.parameters, { patterns: ['needle', 'other'] }).valid).toBe(true)
})

test('grep rejects over-limit pattern batches and mutually supplied forms before searching', async () => {
  workspace = await mkdtemp(join(tmpdir(), 'deepseek-grep-pattern-limit-'))
  const context = {
    workspacePath: workspace, projectRoot: workspace,
    permissionProfile: 'researcher-readonly',
  } as ToolExecutionContext
  const missingDirectory = join(workspace, 'missing')
  const tooMany = await Grep.execute({ patterns: Array.from({ length: 26 }, () => 'needle'), path: missingDirectory }, context)
  const both = await Grep.execute({ pattern: 'needle', patterns: ['needle'], path: missingDirectory }, context)

  expect(tooMany).toBe('Error: patterns cannot exceed 25 per call')
  expect(both).toBe('Error: grep cannot include both pattern and patterns')
})

test('grep rejects an empty scalar pattern before searching', async () => {
  workspace = await mkdtemp(join(tmpdir(), 'deepseek-grep-empty-pattern-'))
  const context = {
    workspacePath: workspace, projectRoot: workspace,
    permissionProfile: 'researcher-readonly',
  } as ToolExecutionContext

  const result = await Grep.execute({ pattern: '', path: join(workspace, 'missing') }, context)

  expect(result).toBe('Error: pattern must be a non-empty regex string')
})

test('grep bounds long matches and the serialized page while preserving continuation', async () => {
  workspace = await mkdtemp(join(tmpdir(), 'deepseek-grep-large-pages-'))
  await writeFile(join(workspace, 'large.ts'), Array.from({ length: 200 }, (_, index) => `needle-${index} ${'x'.repeat(8_000)}`).join('\n'))
  const context = {
    workspacePath: workspace, projectRoot: workspace,
    permissionProfile: 'researcher-readonly',
  } as ToolExecutionContext

  const result = await Grep.execute({ pattern: 'needle', path: workspace }, context)

  expect(Buffer.byteLength(result)).toBeLessThan(60_000)
  expect(result).toContain('[line truncated; use read_file for the full line]')
  expect(result).toContain('of 200 matches. Snapshot: ')
  const nativeNextMatch = Number(result.match(/Showing 1–(\d+) of 200/)?.[1])
  const nativeCursor = result.match(/Continue with grep cursor=([a-f0-9-]+)/)?.[1]
  expect(nativeCursor).toBeTruthy()
  const nativeNextPage = await Grep.execute({ pattern: 'needle', path: workspace, cursor: nativeCursor }, context)
  expect(nativeNextPage).toContain(`needle-${nativeNextMatch}`)

  const javascriptContext = {
    ...context,
    protectedPaths: [join(workspace, 'not-protected.ts')],
  } as ToolExecutionContext
  const javascriptResult = await Grep.execute({ pattern: 'needle', path: workspace }, javascriptContext)
  expect(Buffer.byteLength(javascriptResult)).toBeLessThan(60_000)
  expect(javascriptResult).toContain('[line truncated; use read_file for the full line]')
  expect(javascriptResult).toContain('of 200 matches. Snapshot: ')
  const javascriptNextMatch = Number(javascriptResult.match(/Showing 1–(\d+) of 200/)?.[1])
  const javascriptCursor = javascriptResult.match(/Continue with grep cursor=([a-f0-9-]+)/)?.[1]
  expect(javascriptCursor).toBeTruthy()
  const javascriptNextPage = await Grep.execute({ pattern: 'needle', path: workspace, cursor: javascriptCursor }, javascriptContext)
  expect(javascriptNextPage).toContain(`needle-${javascriptNextMatch}`)
})

test('grep continuation is bound to the search query and matching result snapshot', async () => {
  workspace = await mkdtemp(join(tmpdir(), 'deepseek-grep-cursor-'))
  await writeFile(join(workspace, 'matches.ts'), 'needle one\nneedle two\nneedle three')
  const context = {
    workspacePath: workspace, projectRoot: workspace,
    permissionProfile: 'researcher-readonly',
  } as ToolExecutionContext
  const first = await Grep.execute({ pattern: 'needle', path: workspace, limit: 1 }, context)
  const cursor = first.match(/Continue with grep cursor=([a-f0-9-]+)/)?.[1]
  expect(cursor).toBeTruthy()

  const wrongQuery = await Grep.execute({ pattern: 'other', path: workspace, limit: 1, cursor }, context)
  expect(wrongQuery).toContain('does not match the original search')

  await writeFile(join(workspace, 'matches.ts'), 'needle changed\nneedle two\nneedle three')
  const changed = await Grep.execute({ pattern: 'needle', path: workspace, limit: 1, cursor }, context)
  expect(changed).toContain('search results changed since this cursor')
  expect(changed).not.toContain('needle two')

  const javascriptContext = { ...context, protectedPaths: [join(workspace, 'runtime-private')] }
  const javascriptFirst = await Grep.execute({ pattern: 'needle', path: workspace, limit: 1 }, javascriptContext)
  const javascriptCursor = javascriptFirst.match(/Continue with grep cursor=([a-f0-9-]+)/)?.[1]
  expect(javascriptCursor).toBeTruthy()
  await writeFile(join(workspace, 'matches.ts'), 'needle changed again\nneedle two\nneedle three')
  const javascriptChanged = await Grep.execute({ pattern: 'needle', path: workspace, limit: 1, cursor: javascriptCursor }, javascriptContext)
  expect(javascriptChanged).toContain('search results changed since this cursor')
})

test('grep cursors survive a process restart and remain single-use', async () => {
  workspace = await mkdtemp(join(tmpdir(), 'deepseek-grep-restart-workspace-'))
  isolatedHome = await mkdtemp(join(tmpdir(), 'deepseek-grep-restart-home-'))
  await writeFile(join(workspace, 'matches.ts'), 'needle one\nneedle two\nneedle three')
  const moduleUrl = new URL('../src/tools/Grep/Grep.ts', import.meta.url).href
  const runInFreshProcess = async (cursor?: string, sessionId = 'grep-restart-session') => {
    const script = `
      const { Grep } = await import(${JSON.stringify(moduleUrl)});
      const context = { sessionId: ${JSON.stringify(sessionId)}, workspacePath: ${JSON.stringify(workspace)}, projectRoot: ${JSON.stringify(workspace)}, permissionProfile: 'researcher-readonly' };
      const result = await Grep.execute({ pattern: 'needle', path: ${JSON.stringify(workspace)}, limit: 1${cursor ? `, cursor: ${JSON.stringify(cursor)}` : ''} }, context);
      process.stdout.write(result);
    `
    const result = await execa(process.execPath, ['-e', script], {
      cwd: process.cwd(),
      env: { ...scrubbedEnv(), HOME: isolatedHome!, USERPROFILE: isolatedHome! },
      extendEnv: false,
      reject: false,
    })
    expect({ exitCode: result.exitCode, stderr: result.stderr }).toEqual({ exitCode: 0, stderr: '' })
    return result.stdout
  }

  const firstPage = await runInFreshProcess()
  const cursor = firstPage.match(/Continue with grep cursor=([a-f0-9-]+)/)?.[1]
  expect(cursor).toBeTruthy()

  const nextPage = await runInFreshProcess(cursor)
  expect(nextPage).toContain('2:needle two')
  expect(nextPage).not.toContain('needle one')
  expect(nextPage).not.toContain('needle three')

  const replay = await runInFreshProcess(cursor)
  expect(replay).toContain('grep cursor is unknown or expired')

  await writeFile(join(workspace, 'matches.ts'), 'needle one\nneedle two\nneedle three')
  const staleFirstPage = await runInFreshProcess(undefined, 'grep-stale-restart-session')
  const staleCursor = staleFirstPage.match(/Continue with grep cursor=([a-f0-9-]+)/)?.[1]
  expect(staleCursor).toBeTruthy()
  await writeFile(join(workspace, 'matches.ts'), 'needle changed\nneedle two\nneedle three')
  const changed = await runInFreshProcess(staleCursor, 'grep-stale-restart-session')
  expect(changed).toContain('search results changed since this cursor')
  expect(changed).not.toContain('needle two')
})
