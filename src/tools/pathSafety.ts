import * as fs from 'fs/promises'
import * as path from 'path'

export const BLOCKED_DIRS = [
  '.agent',
  '.claude',
  '.kiro',
  '.github',
  '.deepseek',
  'node_modules',
  'dist',
  'build',
  '.git',
]

/**
 * Padrões de arquivos sensíveis que nunca devem ser lidos pelo agente.
 * Inclui arquivos de credenciais, chaves, tokens e configurações secretas.
 */
const SENSITIVE_FILE_PATTERNS: RegExp[] = [
  /^\.env(\..+)?$/i,           // .env, .env.local, .env.production, etc.
  /^\.env\.[^/]+$/i,           // qualquer variante de .env
  /.*\.pem$/i,                 // chaves privadas PEM
  /.*\.key$/i,                 // arquivos de chave
  /.*\.p12$/i,                 // certificados PKCS#12
  /.*\.pfx$/i,                 // certificados PFX
  /^credentials(\.json)?$/i,   // credentials, credentials.json
  /^secrets?(\.json|\.yaml|\.yml|\.toml)?$/i, // secrets.*
  /^\.netrc$/i,                // credenciais de rede
  /^\.npmrc$/i,                // tokens npm
  /^\.pypirc$/i,               // tokens PyPI
  /^id_rsa(\.pub)?$/i,         // chaves SSH RSA
  /^id_ed25519(\.pub)?$/i,     // chaves SSH Ed25519
  /^id_ecdsa(\.pub)?$/i,       // chaves SSH ECDSA
  /^id_dsa(\.pub)?$/i,         // chaves SSH DSA
  /^known_hosts$/i,            // hosts conhecidos SSH
  /^service.?account.*\.json$/i, // service accounts GCP
  /^gcloud.*\.json$/i,         // credenciais gcloud
  /^\.aws\/credentials$/i,     // credenciais AWS
  /^\.aws\/config$/i,          // config AWS
]

/**
 * Verifica se um nome de arquivo corresponde a um padrão sensível.
 */
function isSensitiveFile(filePath: string): boolean {
  const basename = path.basename(filePath)
  const normalized = filePath.replace(/\\/g, '/')
  return SENSITIVE_FILE_PATTERNS.some((pattern) =>
    pattern.test(basename) || pattern.test(normalized)
  )
}

/**
 * Validates that a file path is safe to access:
 * 1. Must be inside the current working directory
 * 2. Must not be inside a blocked directory
 * 3. Must not escape via symlinks
 * 4. Must not be a sensitive file (credentials, keys, secrets)
 */
export async function assertSafePath(filePath: string): Promise<void> {
  const resolved = path.resolve(filePath)
  const cwd = process.cwd()

  if (!resolved.startsWith(cwd + path.sep) && resolved !== cwd) {
    throw new Error(`Path '${filePath}' is outside the working directory`)
  }

  // Resolve symlinks to prevent traversal attacks
  try {
    const real = await fs.realpath(resolved)
    if (!real.startsWith(cwd + path.sep) && real !== cwd) {
      throw new Error(`Path '${filePath}' resolves outside the working directory (symlink traversal blocked)`)
    }
  } catch (e) {
    // ENOENT = file doesn't exist yet (e.g. write_file creating new file) — safe to skip realpath
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
  }

  const relative = path.relative(cwd, resolved)
  const topDir = relative.split(path.sep)[0]
  if (topDir && BLOCKED_DIRS.includes(topDir)) {
    throw new Error(`Directory '${topDir}/' is off-limits. Use read_folder to see available directories.`)
  }

  // Bloqueia arquivos sensíveis (credenciais, chaves, secrets)
  if (isSensitiveFile(filePath)) {
    throw new Error(`File '${path.basename(filePath)}' is a sensitive file and cannot be read by the agent.`)
  }
}

/**
 * Validates that a directory path is safe to use as cwd/search root.
 * Same rules as assertSafePath but for directories.
 */
export async function assertSafeDir(dirPath: string): Promise<void> {
  return assertSafePath(dirPath)
}

/** Glob ignore patterns derived from BLOCKED_DIRS */
export const BLOCKED_GLOB_PATTERNS = BLOCKED_DIRS.map((d) => `**/${d}/**`)
