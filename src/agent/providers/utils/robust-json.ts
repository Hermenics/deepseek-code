/**
 * Robust JSON parsing utilities.
 * 3-tier repair pipeline ported from ds-free-api + deepsproxy.
 *
 * Pipeline:
 *   1. Direct parse
 *   2. Fix missing braces
 *   3. Repair invalid backslashes (C:\Users\name → C:\\Users\\name)
 *   4. Repair unquoted keys ({name: "x"} → {"name": "x"})
 *   5. Remove trailing commas
 *   6. Aggressive brace completion
 */

// ─── Tier 1: Invalid Backslash Repair ────────────────────────────────────────
// Models often generate Windows paths like C:\Users\name which have invalid
// JSON escape sequences. This repairs them to valid \\-escaped form.

function repairInvalidBackslashes(s: string): string {
  const validEscapes = new Set(['"', '\\', '/', 'b', 'f', 'n', 'r', 't', 'u'])
  let out = ''
  let i = 0

  while (i < s.length) {
    if (s[i] === '\\') {
      const next = s[i + 1]
      if (next && validEscapes.has(next)) {
        // Valid escape — keep as-is
        if (next === 'u' && i + 5 < s.length) {
          // Validate \uXXXX
          const hex = s.slice(i + 2, i + 6)
          if (/^[0-9a-fA-F]{4}$/.test(hex)) {
            out += s.slice(i, i + 6)
            i += 6
            continue
          }
        }
        out += '\\'
        out += next
        i += 2
      } else {
        // Invalid escape — double the backslash
        out += '\\\\'
        i += 1
      }
    } else {
      out += s[i]
      i++
    }
  }

  return out
}

// ─── Tier 2: Unquoted Key Repair ─────────────────────────────────────────────
// Models sometimes output {name: "value"} instead of {"name": "value"}

function repairUnquotedKeys(s: string): string {
  // Match unquoted keys after { or , followed by :
  return s.replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":')
}

// ─── Tier 3: Trailing Comma Removal ──────────────────────────────────────────

function removeTrailingCommas(s: string): string {
  return s.replace(/,\s*([}\]])/g, '$1')
}

// ─── Brace Balancing ─────────────────────────────────────────────────────────

function countOpenBraces(s: string): number {
  let open = 0
  let inString = false
  let escaped = false

  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!
    if (escaped) { escaped = false; continue }
    if (ch === '\\' && inString) { escaped = true; continue }
    if (ch === '"' && !escaped) { inString = !inString; continue }
    if (!inString) {
      if (ch === '{') open++
      else if (ch === '}') open--
    }
  }

  return open
}

function completeBraces(s: string): string {
  const open = countOpenBraces(s)
  if (open > 0) return s + '}'.repeat(open)
  return s
}

// ─── Main Entry Point ────────────────────────────────────────────────────────

export function robustParseJSON(str: string): any {
  if (!str) return null
  let sanitized = str.trim()

  // Remove markdown code blocks if present
  sanitized = sanitized.replace(/^```(?:json|text|typescript|js)?\s*\n?/, '').replace(/\n?```\s*$/, '').trim()

  // Try to find the first '{' or '['
  const firstBrace = sanitized.indexOf('{')
  const firstBracket = sanitized.indexOf('[')
  let startIdx: number

  if (firstBrace === -1 && firstBracket === -1) return null
  if (firstBrace === -1) startIdx = firstBracket
  else if (firstBracket === -1) startIdx = firstBrace
  else startIdx = Math.min(firstBrace, firstBracket)

  let jsonPart = sanitized.substring(startIdx)

  // ── Attempt 1: Direct parse ──────────────────────────────────────────────
  try {
    return JSON.parse(jsonPart)
  } catch { /* continue to repairs */ }

  // ── Attempt 2: Complete missing braces ───────────────────────────────────
  const completed = completeBraces(jsonPart)
  try {
    return JSON.parse(completed)
  } catch { /* continue */ }

  // ── Attempt 3: Repair backslashes ────────────────────────────────────────
  const step1 = repairInvalidBackslashes(jsonPart)
  try {
    return JSON.parse(completeBraces(step1))
  } catch { /* continue */ }

  // ── Attempt 4: Repair unquoted keys ──────────────────────────────────────
  const step2 = repairUnquotedKeys(step1)
  try {
    return JSON.parse(completeBraces(step2))
  } catch { /* continue */ }

  // ── Attempt 5: Remove trailing commas ────────────────────────────────────
  const step3 = removeTrailingCommas(step2)
  try {
    return JSON.parse(completeBraces(step3))
  } catch { /* continue */ }

  // ── Attempt 6: Aggressive — strip everything after last valid } ──────────
  const lastBrace = step3.lastIndexOf('}')
  if (lastBrace !== -1) {
    const truncated = step3.slice(0, lastBrace + 1)
    try {
      return JSON.parse(truncated)
    } catch { /* give up */ }
  }

  return null
}

// ─── Exported Repair Utilities (for testing) ─────────────────────────────────

export { repairInvalidBackslashes, repairUnquotedKeys, removeTrailingCommas, completeBraces }
