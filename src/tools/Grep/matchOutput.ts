import { GREP_MAX_MATCH_CHARS } from '../../constants.js'
import { safeGraphemeEnd } from '../../utils/textBoundaries.js'

const TRUNCATION_NOTICE = ' [line truncated; use read_file for the full line]'

export interface GrepMatch {
  file: string
  lineNumber: number
  text: string
  formatted: string
}

export function formatGrepMatch(file: string, lineNumber: number, text: string, sourceTruncated = false): GrepMatch {
  const prefix = `${file}:${lineNumber}:`
  const available = Math.max(0, GREP_MAX_MATCH_CHARS - prefix.length - TRUNCATION_NOTICE.length)
  const end = safeGraphemeEnd(text, available)
  const visibleText = end === text.length && !sourceTruncated ? text : `${text.slice(0, end)}${TRUNCATION_NOTICE}`
  return { file, lineNumber, text: visibleText, formatted: `${prefix}${visibleText}` }
}
