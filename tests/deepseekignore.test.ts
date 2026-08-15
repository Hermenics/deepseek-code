import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import {
  isPathIgnored,
  ignoredPathError,
  ignoreDirNames,
  ignoreFileStatus,
  writeIgnoreDefaults,
  clearIgnoreCache,
  hasEditorAssociation,
  writeEditorAssociation,
  shouldOfferEditorAssociation,
  getEditorSettingsPath,
  IGNORE_FILE_NAME,
  DEFAULT_IGNORE_LINES,
} from '../src/tools/shared/deepseekignore.js'
import { resolveSafePath } from '../src/tools/shared/pathSafety.js'
import { findIgnoredShellPath } from '../src/tools/Shell/Shell.js'
import { Grep } from '../src/tools/Grep/Grep.js'

let root: string

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsk-ignore-'))
  clearIgnoreCache()
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
  clearIgnoreCache()
})

function writeIgnoreFile(content: string) {
  fs.writeFileSync(path.join(root, IGNORE_FILE_NAME), content, 'utf8')
  clearIgnoreCache()
}

describe('isPathIgnored', () => {
  it('applies built-in defaults when no ignore file exists', () => {
    expect(isPathIgnored(path.join(root, 'node_modules/lib/index.js'), root)).toBe(true)
    expect(isPathIgnored(path.join(root, 'src/index.ts'), root)).toBe(false)
  })

  it('uses the file instead of defaults when present', () => {
    writeIgnoreFile('secrets-dir/\n')
    expect(isPathIgnored(path.join(root, 'secrets-dir/a.txt'), root)).toBe(true)
    // defaults no longer apply — the file is the source of truth
    expect(isPathIgnored(path.join(root, 'dist/bundle.js'), root)).toBe(false)
  })

  it('supports gitignore-style negation', () => {
    // gitignore rule: a file inside an excluded DIRECTORY cannot be
    // re-included, so the pattern must be `logs/*`, not `logs/`
    writeIgnoreFile('logs/*\n!logs/keep.txt\n')
    expect(isPathIgnored(path.join(root, 'logs/app.log'), root)).toBe(true)
    expect(isPathIgnored(path.join(root, 'logs/keep.txt'), root)).toBe(false)
  })

  it('never lifts the safety core, even with an empty file', () => {
    writeIgnoreFile('')
    expect(isPathIgnored(path.join(root, '.git/config'), root)).toBe(true)
    expect(isPathIgnored(path.join(root, '.deepseek/state.json'), root)).toBe(true)
  })

  it('cannot re-include safety paths with negated entries', () => {
    writeIgnoreFile('!.git/\n!.deepseek/\n')
    expect(isPathIgnored(path.join(root, '.git/config'), root)).toBe(true)
    expect(isPathIgnored(path.join(root, '.deepseek/state.json'), root)).toBe(true)
  })

  it('re-reads the file when it changes', () => {
    writeIgnoreFile('alpha/\n')
    expect(isPathIgnored(path.join(root, 'alpha/x'), root)).toBe(true)
    const ignorePath = path.join(root, IGNORE_FILE_NAME)
    fs.writeFileSync(ignorePath, 'beta/\n', 'utf8')
    const later = new Date(Date.now() + 1000)
    fs.utimesSync(ignorePath, later, later)
    expect(isPathIgnored(path.join(root, 'alpha/x'), root)).toBe(false)
    expect(isPathIgnored(path.join(root, 'beta/x'), root)).toBe(true)
  })

  it('ignores paths outside the root', () => {
    expect(isPathIgnored('/etc/passwd', root)).toBe(false)
  })
})

describe('ignoredPathError', () => {
  it('names the ignore file so the model does not hallucinate', () => {
    writeIgnoreFile('blocked/\n')
    const err = ignoredPathError('blocked/file.ts', root)
    expect(err.message).toContain(IGNORE_FILE_NAME)
    expect(err.message).toContain('ask the user')
  })

  it('says defaults apply when there is no file', () => {
    const err = ignoredPathError('node_modules/x', root)
    expect(err.message).toContain('default ignore list')
  })
})

describe('resolveSafePath integration', () => {
  it('blocks access to a directory listed in .deepseekignore', async () => {
    writeIgnoreFile('private/\n')
    fs.mkdirSync(path.join(root, 'private'), { recursive: true })
    fs.writeFileSync(path.join(root, 'private/data.txt'), 'x')
    await expect(resolveSafePath('private/data.txt', { workspacePath: root } as any))
      .rejects.toThrow(IGNORE_FILE_NAME)
  })

  it('blocks node_modules through defaults when no file exists', async () => {
    fs.mkdirSync(path.join(root, 'node_modules/pkg'), { recursive: true })
    fs.writeFileSync(path.join(root, 'node_modules/pkg/index.js'), 'x')
    await expect(resolveSafePath('node_modules/pkg/index.js', { workspacePath: root } as any))
      .rejects.toThrow(/default ignore list/)
  })

  it('allows a dir the user removed from the ignore file', async () => {
    writeIgnoreFile('# nothing ignored\n')
    fs.mkdirSync(path.join(root, 'dist'), { recursive: true })
    fs.writeFileSync(path.join(root, 'dist/out.js'), 'x')
    await expect(resolveSafePath('dist/out.js', { workspacePath: root } as any))
      .resolves.toContain('dist')
  })

  it('still blocks .git even when the ignore file is permissive', async () => {
    writeIgnoreFile('# nothing\n')
    fs.mkdirSync(path.join(root, '.git'), { recursive: true })
    fs.writeFileSync(path.join(root, '.git/config'), 'x')
    await expect(resolveSafePath('.git/config', { workspacePath: root } as any))
      .rejects.toThrow()
  })
})

describe('ignoreDirNames', () => {
  it('extracts simple directory names for grep excludes', () => {
    writeIgnoreFile('node_modules/\ncustom-cache\n*.log\ndeep/nested/\n')
    const names = ignoreDirNames(root)
    expect(names).toContain('node_modules')
    expect(names).toContain('custom-cache')
    expect(names).not.toContain('*.log')
    expect(names).not.toContain('deep/nested')
  })
})

describe('ignoreFileStatus / writeIgnoreDefaults', () => {
  it('reports all defaults missing when there is no file', () => {
    const status = ignoreFileStatus(root)
    expect(status.exists).toBe(false)
    expect(status.missingDefaults.length).toBeGreaterThan(10)
  })

  it('creates the file with defaults', () => {
    const written = writeIgnoreDefaults(root)
    expect(written.length).toBeGreaterThan(10)
    const content = fs.readFileSync(path.join(root, IGNORE_FILE_NAME), 'utf8')
    expect(content).toContain('node_modules/')
    // fully covered now
    expect(ignoreFileStatus(root)).toEqual({ exists: true, missingDefaults: [] })
  })

  it('appends only the missing defaults to an existing file', () => {
    writeIgnoreFile('node_modules/\nmy-own-dir/\n')
    const written = writeIgnoreDefaults(root)
    expect(written).not.toContain('node_modules/')
    const content = fs.readFileSync(path.join(root, IGNORE_FILE_NAME), 'utf8')
    expect(content).toContain('my-own-dir/')
    expect(content).toContain('dist/')
    expect(ignoreFileStatus(root).missingDefaults).toEqual([])
  })

  it('treats trailing slash as optional when matching defaults', () => {
    writeIgnoreFile(DEFAULT_IGNORE_LINES.filter((l) => !l.startsWith('#')).map((l) => l.replace(/\/$/, '')).join('\n'))
    expect(ignoreFileStatus(root).missingDefaults).toEqual([])
  })
})

describe('editor association', () => {
  const editorOptions = () => ({
    platform: 'linux' as NodeJS.Platform,
    home: root,
    env: { TERM_PROGRAM: 'vscode' },
  })
  const settingsPath = () => getEditorSettingsPath(editorOptions())!
  const readSettings = () => JSON.parse(fs.readFileSync(settingsPath(), 'utf8'))

  it('resolves global User settings on Linux, macOS and Windows', () => {
    expect(getEditorSettingsPath({ platform: 'linux', home: root, env: { TERM_PROGRAM: 'vscode' } }))
      .toBe(path.join(root, '.config', 'Code', 'User', 'settings.json'))
    expect(getEditorSettingsPath({ platform: 'darwin', home: root, env: { TERM_PROGRAM: 'vscode' } }))
      .toBe(path.join(root, 'Library', 'Application Support', 'Code', 'User', 'settings.json'))
    expect(getEditorSettingsPath({ platform: 'win32', home: root, env: { TERM_PROGRAM: 'vscode', APPDATA: path.join(root, 'AppData', 'Roaming') } }))
      .toBe(path.join(root, 'AppData', 'Roaming', 'Code', 'User', 'settings.json'))
  })

  it('reports no association on a fresh project', () => {
    expect(hasEditorAssociation(root, editorOptions())).toBe(false)
  })

  it('does not offer VS Code setup for an unrelated fresh project', () => {
    expect(shouldOfferEditorAssociation(root, { platform: 'linux', home: root, env: {} })).toBe(false)
  })

  it('creates global User settings when absent', () => {
    writeEditorAssociation(root, editorOptions())
    expect(readSettings()['files.associations']).toEqual({ [IGNORE_FILE_NAME]: 'ignore' })
    expect(hasEditorAssociation(root, editorOptions())).toBe(true)
  })

  it('preserves unrelated settings and other associations', () => {
    fs.mkdirSync(path.dirname(settingsPath()), { recursive: true })
    fs.writeFileSync(settingsPath(), JSON.stringify({
      'editor.fontSize': 14,
      'files.associations': { '*.foo': 'json' },
    }), 'utf8')
    writeEditorAssociation(root, editorOptions())
    const settings = readSettings()
    expect(settings['editor.fontSize']).toBe(14)
    expect(settings['files.associations']['*.foo']).toBe('json')
    expect(settings['files.associations'][IGNORE_FILE_NAME]).toBe('ignore')
  })

  it('handles JSONC comments that VS Code allows', () => {
    fs.mkdirSync(path.dirname(settingsPath()), { recursive: true })
    fs.writeFileSync(settingsPath(), '{\n  // my theme\n  "workbench.colorTheme": "Dark+" /* inline */\n}', 'utf8')
    expect(hasEditorAssociation(root, editorOptions())).toBe(false)
    writeEditorAssociation(root, editorOptions())
    expect(readSettings()['workbench.colorTheme']).toBe('Dark+')
    expect(hasEditorAssociation(root, editorOptions())).toBe(true)
  })

  it('handles JSONC trailing commas', () => {
    fs.mkdirSync(path.dirname(settingsPath()), { recursive: true })
    fs.writeFileSync(settingsPath(), '{\n  "editor.fontSize": 14,\n  "files.associations": {\n    ".deepseekignore": "ignore",\n  },\n}', 'utf8')
    expect(hasEditorAssociation(root, editorOptions())).toBe(true)
    writeEditorAssociation(root, editorOptions())
    expect(readSettings()['editor.fontSize']).toBe(14)
    expect(readSettings()['files.associations'][IGNORE_FILE_NAME]).toBe('ignore')
  })

  it('does not treat a URL inside a string as a comment', () => {
    fs.mkdirSync(path.dirname(settingsPath()), { recursive: true })
    fs.writeFileSync(settingsPath(), JSON.stringify({ 'my.url': 'https://example.com/x' }), 'utf8')
    writeEditorAssociation(root, editorOptions())
    expect(readSettings()['my.url']).toBe('https://example.com/x')
  })

  it('refuses to clobber a settings file it cannot parse', () => {
    fs.mkdirSync(path.dirname(settingsPath()), { recursive: true })
    fs.writeFileSync(settingsPath(), '{ this is not json', 'utf8')
    expect(() => writeEditorAssociation(root, editorOptions())).toThrow()
    expect(fs.readFileSync(settingsPath(), 'utf8')).toBe('{ this is not json')
  })

  it('is idempotent', () => {
    writeEditorAssociation(root, editorOptions())
    writeEditorAssociation(root, editorOptions())
    expect(readSettings()['files.associations']).toEqual({ [IGNORE_FILE_NAME]: 'ignore' })
  })
})

describe('findIgnoredShellPath', () => {
  it('flags an existing ignored path used as an argument', () => {
    fs.mkdirSync(path.join(root, 'node_modules/pkg'), { recursive: true })
    fs.writeFileSync(path.join(root, 'node_modules/pkg/index.js'), 'x')
    expect(findIgnoredShellPath('cat node_modules/pkg/index.js', root)).toBe('node_modules/pkg/index.js')
  })

  it('flags bare ignored directories and quoted paths with spaces', () => {
    writeIgnoreFile('private/\nprivate files/\n')
    fs.mkdirSync(path.join(root, 'private'))
    fs.mkdirSync(path.join(root, 'private files'))
    fs.writeFileSync(path.join(root, 'private files/data.txt'), 'x')
    expect(findIgnoredShellPath('ls private', root)).toBe('private')
    expect(findIgnoredShellPath('cat "private files/data.txt"', root)).toBe('private files/data.txt')
  })

  it('lets ordinary commands through', () => {
    fs.mkdirSync(path.join(root, 'src'), { recursive: true })
    expect(findIgnoredShellPath('ls src && echo done', root)).toBeNull()
  })

  it('does not flag non-existent path-like tokens (regex, URLs)', () => {
    expect(findIgnoredShellPath('grep "node_modules/foo" src', root)).toBeNull()
    expect(findIgnoredShellPath('curl https://example.com/node_modules', root)).toBeNull()
  })
})

describe('Grep', () => {
  it('filters an ignored filename containing a colon', async () => {
    writeIgnoreFile('ignored:file.txt\n')
    fs.writeFileSync(path.join(root, 'ignored:file.txt'), 'needle\n')
    const result = await Grep.execute(
      { pattern: 'needle', path: root },
      { workspacePath: root } as any,
    )
    expect(result).toBe('No matches')
  })
})
