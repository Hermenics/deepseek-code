import * as fs from 'node:fs'
import { homedir } from 'node:os'
import * as path from 'node:path'
import ignore, { type Ignore } from 'ignore'

/** Name of the ignore file read from the workspace root. */
export const IGNORE_FILE_NAME = '.deepseekignore'
const IGNORE_PROMPT_STATE_FILE = 'ignore-prompts.json'

/**
 * Recommended defaults — the directories that used to be hard-coded across
 * the tools (BLOCKED_DIRS + grep/glob extras). When no .deepseekignore
 * exists these apply in memory, so a project is protected out of the box;
 * the TUI offers to materialize them into the file (see ignoreFileStatus).
 */
export const DEFAULT_IGNORE_LINES: string[] = [
  '# Directories DeepSeek Code ignores by default',
  'node_modules/',
  'dist/',
  'build/',
  'out/',
  'coverage/',
  'vendor/',
  'bower_components/',
  'tmp/',
  '.tmp/',
  'logs/',
  '.agent/',
  '.claude/',
  '.kiro/',
  '.github/',
  '.cache/',
  '.next/',
  '.nuxt/',
  '.svelte-kit/',
  '.angular/',
  '.turbo/',
  '.parcel-cache/',
  '.yarn/',
  '.pnpm-store/',
  '.eslintcache',
  '.venv/',
  'venv/',
  '__pycache__/',
  '.mypy_cache/',
  '.pytest_cache/',
  '.ipynb_checkpoints/',
  '.vscode/',
  '.idea/',
  'target/',
]

/**
 * Always ignored, whether or not a .deepseekignore exists. Deleting a line
 * from the file must never expose the git store or DeepSeek's own state.
 * (Sensitive files — .env, keys — are a separate check in pathSafety.)
 */
const SAFETY_LINES = ['.git/', '.deepseek/']

interface CacheEntry {
  matcher: Ignore
  fromFile: boolean
  /** mtimeMs of the ignore file, or -1 when absent. */
  mtimeMs: number
}

// Cache per workspace root. Synchronous fs on purpose: the file is tiny, read
// once per mtime change, and sync keeps isPathIgnored usable from sync code.
const cache = new Map<string, CacheEntry>()
const promptedIgnoreRoots = new Set<string>()

function loadMatcher(root: string): CacheEntry {
  const filePath = path.join(root, IGNORE_FILE_NAME)
  let mtimeMs = -1
  let content: string | null = null
  try {
    const stat = fs.statSync(filePath)
    mtimeMs = stat.mtimeMs
    const cached = cache.get(root)
    if (cached && cached.mtimeMs === mtimeMs) return cached
    content = fs.readFileSync(filePath, 'utf8')
  } catch {
    const cached = cache.get(root)
    if (cached && cached.mtimeMs === -1) return cached
  }

  const matcher = ignore()
  if (content !== null) matcher.add(content)
  else matcher.add(DEFAULT_IGNORE_LINES)
  matcher.add(SAFETY_LINES)

  const entry: CacheEntry = { matcher, fromFile: content !== null, mtimeMs }
  cache.set(root, entry)
  return entry
}

/** Drops cached matchers — used by tests and by the TUI after editing the file. */
export function clearIgnoreCache(): void {
  cache.clear()
}

/**
 * True when `absolutePath` (inside `root`) is ignored. Paths outside the
 * root are never ignored by this check — pathSafety handles containment.
 */
export function isPathIgnored(absolutePath: string, root: string): boolean {
  const relative = path.relative(root, absolutePath)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return false
  const normalized = relative.split(path.sep).join('/')
  const matcher = loadMatcher(root).matcher
  if (matcher.ignores(normalized)) return true
  try {
    return fs.statSync(absolutePath).isDirectory() && matcher.ignores(`${normalized}/`)
  } catch {
    return false
  }
}

/**
 * Error shown to the model. Explicit about the cause so the LLM explains the
 * block instead of hallucinating around a missing file.
 */
export function ignoredPathError(displayPath: string, root: string): Error {
  const source = loadMatcher(root).fromFile
    ? `${IGNORE_FILE_NAME} at the project root`
    : `DeepSeek Code's default ignore list (no ${IGNORE_FILE_NAME} found — defaults apply)`
  return new Error(
    `Path '${displayPath}' is excluded by ${source}. ` +
    `This is intentional: the user controls access via ${IGNORE_FILE_NAME}. ` +
    `Do not guess its contents; if access is genuinely needed, ask the user to edit ${IGNORE_FILE_NAME}.`,
  )
}

/** Directory names (simple `name/` or `name` lines) usable as fast excludes in Grep/ReadFolder. */
export function ignoreDirNames(root: string): string[] {
  const lines = activeIgnoreLines(root)
  return lines
    .filter((line) => /^[\w.@-]+\/?$/.test(line))
    .map((line) => line.replace(/\/$/, ''))
}

/** Raw active pattern lines (file when present, defaults otherwise), comments stripped. */
export function activeIgnoreLines(root: string): string[] {
  const filePath = path.join(root, IGNORE_FILE_NAME)
  let raw: string[]
  try {
    raw = fs.readFileSync(filePath, 'utf8').split('\n')
  } catch {
    raw = DEFAULT_IGNORE_LINES
  }
  return [...SAFETY_LINES, ...raw]
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
}

export interface IgnoreFileStatus {
  /** File exists at the workspace root. */
  exists: boolean
  /** Default lines not yet covered by the file (empty when exists && complete). */
  missingDefaults: string[]
}

/**
 * Setup status for the TUI prompt: which recommended defaults the project's
 * .deepseekignore is missing. A default counts as covered when its pattern
 * line is present (exact match, trailing slash optional).
 */
export function ignoreFileStatus(root: string): IgnoreFileStatus {
  const filePath = path.join(root, IGNORE_FILE_NAME)
  let content: string
  try {
    content = fs.readFileSync(filePath, 'utf8')
  } catch {
    return { exists: false, missingDefaults: DEFAULT_IGNORE_LINES.filter((l) => !l.startsWith('#')) }
  }
  const present = new Set(
    content.split('\n').map((line) => line.trim().replace(/\/$/, '')).filter(Boolean),
  )
  const missing = DEFAULT_IGNORE_LINES
    .filter((line) => !line.startsWith('#'))
    .filter((line) => !present.has(line.replace(/\/$/, '')))
  return { exists: true, missingDefaults: missing }
}

function ignorePromptStatePath(): string {
  return path.join(homedir(), '.deepseek', IGNORE_PROMPT_STATE_FILE)
}

/** Remembers the answer to the materialization prompt once per workspace. */
export function shouldOfferIgnoreDefaults(root: string): boolean {
  const workspace = path.resolve(root)
  if (promptedIgnoreRoots.has(workspace)) return false
  try {
    const state = JSON.parse(fs.readFileSync(ignorePromptStatePath(), 'utf8')) as Record<string, unknown>
    const prompted = state[workspace] === true
    if (prompted) promptedIgnoreRoots.add(workspace)
    return !prompted
  } catch {
    return true
  }
}

export function markIgnoreDefaultsPrompted(root: string): void {
  const workspace = path.resolve(root)
  promptedIgnoreRoots.add(workspace)
  const filePath = ignorePromptStatePath()
  let state: Record<string, unknown> = {}
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) state = parsed as Record<string, unknown>
  } catch { /* initialize the state file */ }
  state[workspace] = true
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
  } catch { /* harmless fallback: this process still will not ask again */ }
}

// ── Editor association ──────────────────────────────────────────────────────
// A file icon comes from the editor's icon theme, which only an extension can
// contribute — nothing installed via npm can reach it. What we CAN do is map
// the file to the built-in `ignore` language, so it inherits whatever
// ignore-file icon the user's theme already ships, plus syntax highlighting.

const ASSOCIATION_LANGUAGE = 'ignore'
type EditorKind = 'code' | 'cursor' | 'windsurf' | 'vscodium' | 'kiro'

export interface EditorAssociationOptions {
  platform?: NodeJS.Platform
  home?: string
  env?: NodeJS.ProcessEnv
}

const EDITOR_FOLDERS: Record<EditorKind, string> = {
  code: 'Code',
  cursor: 'Cursor',
  windsurf: 'Windsurf',
  vscodium: 'VSCodium',
  kiro: 'Kiro',
}

function detectEditor(env: NodeJS.ProcessEnv): EditorKind | null {
  const terminal = env.TERM_PROGRAM?.toLowerCase()
  if (terminal === 'cursor') return 'cursor'
  if (terminal === 'windsurf') return 'windsurf'
  if (terminal === 'vscodium' || terminal === 'codium') return 'vscodium'
  if (terminal === 'kiro') return 'kiro'
  if (terminal === 'vscode' || terminal === 'code' || env.VSCODE_PID || env.VSCODE_IPC_HOOK_CLI) return 'code'
  return null
}

/** Returns the detected editor's global User settings path for any OS. */
export function getEditorSettingsPath(options: EditorAssociationOptions = {}): string | null {
  const env = options.env ?? process.env
  const editor = detectEditor(env)
  if (!editor) return null

  const home = options.home ?? homedir()
  const platform = options.platform ?? process.platform
  const base = platform === 'win32'
    ? (env.APPDATA ?? path.join(home, 'AppData', 'Roaming'))
    : platform === 'darwin'
      ? path.join(home, 'Library', 'Application Support')
      : (env.XDG_CONFIG_HOME ?? path.join(home, '.config'))
  return path.join(base, EDITOR_FOLDERS[editor], 'User', 'settings.json')
}

/**
 * Only offer the global write when there is evidence of VS Code or a compatible
 * fork. Other editors need their own native integration.
 */
export function shouldOfferEditorAssociation(_root: string, options: EditorAssociationOptions = {}): boolean {
  return getEditorSettingsPath(options) !== null
}

/** True when global User settings already map the ignore file to a language. */
export function hasEditorAssociation(_root: string, options: EditorAssociationOptions = {}): boolean {
  const filePath = getEditorSettingsPath(options)
  if (!filePath) return false
  try {
    const raw = fs.readFileSync(filePath, 'utf8')
    const settings = parseJsonc(raw) as Record<string, unknown>
    const associations = settings['files.associations'] as Record<string, string> | undefined
    return typeof associations?.[IGNORE_FILE_NAME] === 'string'
  } catch {
    return false
  }
}

/**
 * Adds the association to global User settings, creating the file if needed.
 * Only ever adds one key — the rest of the user's settings are preserved.
 * Throws when the file exists but is not parseable, so the caller can report
 * it instead of clobbering hand-written settings.
 */
export function writeEditorAssociation(_root: string, options: EditorAssociationOptions = {}): void {
  const filePath = getEditorSettingsPath(options)
  if (!filePath) throw new Error('No supported VS Code-compatible editor was detected')
  const dir = path.dirname(filePath)
  let settings: Record<string, unknown> = {}
  try {
    const raw = fs.readFileSync(filePath, 'utf8')
    if (raw.trim()) {
      const parsed = parseJsonc(raw) as unknown
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('settings.json is not a JSON object')
      }
      settings = parsed as Record<string, unknown>
    }
  } catch (error) {
    // ENOENT is the normal "create it" case; anything else means the file is
    // there but unusable, and silently overwriting it would lose user config.
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const existing = settings['files.associations']
  const associations: Record<string, unknown> =
    typeof existing === 'object' && existing !== null && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {}
  associations[IGNORE_FILE_NAME] = ASSOCIATION_LANGUAGE
  settings['files.associations'] = associations
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify(settings, null, 2) + '\n', 'utf8')
}

function parseJsonc(text: string): unknown {
  return JSON.parse(removeTrailingCommas(stripJsonComments(text)))
}

function removeTrailingCommas(text: string): string {
  let out = ''
  let inString = false
  let escaped = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!
    if (inString) {
      out += char
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') { inString = true; out += char; continue }
    if (char === ',') {
      let next = i + 1
      while (/\s/.test(text[next] ?? '')) next++
      if (text[next] === '}' || text[next] === ']') continue
    }
    out += char
  }
  return out
}

/** Strips // and /* *​/ comments — VS Code settings are JSONC, not strict JSON. */
function stripJsonComments(text: string): string {
  let out = ''
  let inString = false
  let inLine = false
  let inBlock = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    const next = text[i + 1]
    if (inLine) {
      if (ch === '\n') { inLine = false; out += ch }
      continue
    }
    if (inBlock) {
      if (ch === '*' && next === '/') { inBlock = false; i++ }
      continue
    }
    if (inString) {
      out += ch
      if (ch === '\\') { out += next ?? ''; i++ }
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') { inString = true; out += ch; continue }
    if (ch === '/' && next === '/') { inLine = true; i++; continue }
    if (ch === '/' && next === '*') { inBlock = true; i++; continue }
    out += ch
  }
  return out
}

/** Creates or appends the missing defaults. Returns the lines written. */
export function writeIgnoreDefaults(root: string): string[] {
  const status = ignoreFileStatus(root)
  if (status.exists && status.missingDefaults.length === 0) return []
  const filePath = path.join(root, IGNORE_FILE_NAME)
  if (!status.exists) {
    fs.writeFileSync(filePath, DEFAULT_IGNORE_LINES.join('\n') + '\n', 'utf8')
  } else {
    const current = fs.readFileSync(filePath, 'utf8')
    const separator = current.endsWith('\n') || current.length === 0 ? '' : '\n'
    fs.appendFileSync(
      filePath,
      `${separator}\n# Added by DeepSeek Code (previously built-in defaults)\n${status.missingDefaults.join('\n')}\n`,
      'utf8',
    )
  }
  clearIgnoreCache()
  return status.missingDefaults
}
