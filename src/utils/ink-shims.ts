import { execFile } from 'child_process'
import {
  type AnsiCode,
  ansiCodesToString,
  reduceAnsiCodes,
  tokenize,
  undoAnsiCodes,
} from '@alcalzone/ansi-tokenize'
import { stringWidth } from '../ink/stringWidth.js'

export function logForDebugging(..._args: unknown[]): void {}

// A code is an "end code" if its code equals its endCode (e.g., hyperlink close)
function isEndCode(code: AnsiCode): boolean {
  return code.code === code.endCode
}

// Filter to only include "start codes" (not end codes)
function filterStartCodes(codes: AnsiCode[]): AnsiCode[] {
  return codes.filter(c => !isEndCode(c))
}

/**
 * Slice a string containing ANSI escape codes.
 *
 * Unlike the slice-ansi package, this properly handles OSC 8 hyperlink
 * sequences because @alcalzone/ansi-tokenize tokenizes them correctly.
 */
export function sliceAnsi(str: string, start: number, end?: number): string {
  const tokens = tokenize(str)
  let activeCodes: AnsiCode[] = []
  let position = 0
  let result = ''
  let include = false

  for (const token of tokens) {
    const width =
      token.type === 'ansi' ? 0 :
      token.type === 'control' ? 0 :
      token.fullWidth ? 2 : stringWidth(token.value)

    if (end !== undefined && position >= end) {
      if (token.type === 'ansi' || width > 0 || !include) break
    }

    if (token.type === 'ansi') {
      activeCodes.push(token)
      if (include) {
        result += token.code
      }
    } else if (token.type === 'char') {
      if (!include && position >= start) {
        if (start > 0 && width === 0) continue
        include = true
        activeCodes = filterStartCodes(reduceAnsiCodes(activeCodes))
        result = ansiCodesToString(activeCodes)
      }

      if (include) {
        result += token.value
      }

      position += width
    }
    // token.type === 'control': skip (no value, no width)
  }

  const activeStartCodes = filterStartCodes(reduceAnsiCodes(activeCodes))
  result += ansiCodesToString(undoAnsiCodes(activeStartCodes))
  return result
}

let graphemeSegmenter: Intl.Segmenter | null = null

export function getGraphemeSegmenter(): Intl.Segmenter {
  if (!graphemeSegmenter) {
    graphemeSegmenter = new Intl.Segmenter(undefined, {
      granularity: 'grapheme',
    })
  }
  return graphemeSegmenter
}

export const env: Record<string, string | undefined> = process.env as Record<
  string,
  string | undefined
>

export function gte(a: string, b: string): boolean {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return true
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return false
  }
  return true
}

export function isEnvTruthy(val: string | undefined): boolean {
  return val === '1' || val === 'true'
}

export function logError(..._args: unknown[]): void {}

export function execFileNoThrow(
  cmd: string,
  args: string[],
  opts?: { input?: string; timeout?: number; useCwd?: boolean },
): Promise<{ stdout: string; stderr: string; exitCode: number; code: number }> {
  return new Promise(resolve => {
    const child = execFile(cmd, args, { timeout: opts?.timeout }, (err, stdout, stderr) => {
      const exitCode = err?.code ? 1 : 0
      resolve({ stdout: stdout ?? '', stderr: stderr ?? '', exitCode, code: exitCode })
    })
    if (opts?.input && child.stdin) {
      child.stdin.write(opts.input)
      child.stdin.end()
    }
  })
}

export function stopCapturingEarlyInput(): void {}

export function updateLastInteractionTime(): void {}

export function getSessionId(): string {
  return 'deepseek-session'
}
