import { fileURLToPath } from 'node:url'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll } from 'bun:test'
import { removeTempDirectory } from './helpers/removeTempDirectory.js'

// Preloads run in each isolated file: fixture sessions/memory never touch the user's real state.
const home = mkdtempSync(join(tmpdir(), 'deepseek-test-home-'))
process.env.HOME = home
process.env.USERPROFILE = home
process.env.LOCALAPPDATA = join(home, 'AppData', 'Local')
process.env.XDG_STATE_HOME = join(home, '.local', 'state')
process.env.XDG_CONFIG_HOME = join(home, '.config')
process.env.XDG_CACHE_HOME = join(home, '.cache')
process.env.DEEPSEEK_HISTORY_PATH = join(home, 'history.json')
afterAll(() => removeTempDirectory(home))

// Fixture Git commands must not inherit a developer's signing, filters, hooks or CRLF policy.
// Repository-local configuration remains available to tests that deliberately exercise it.
process.env.GIT_CONFIG_NOSYSTEM = '1'
process.env.GIT_CONFIG_GLOBAL = fileURLToPath(new URL('./fixtures/test.gitconfig', import.meta.url))
process.env.GIT_TERMINAL_PROMPT = '0'
