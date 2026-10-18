import { describe, it, expect } from 'bun:test'
import { assessRisk, DEFAULT_RISK_RULES, hasImplicitCloudMutationTarget, hasNetworkCapability, hasPackageLifecycleScriptExecution, hasPackageScriptExecution, packageInstallLifecyclePolicy } from '../../src/permissions/risk.js'
import type { RiskContext } from '../../src/permissions/types.js'

// Helper
const ctx = (overrides?: Partial<RiskContext>): RiskContext => ({
  isSubAgent: false,
  recentWriteCount: 0,
  config: {},
  ...overrides,
})

function nestDollarSubstitutions(command: string, depth: number): string {
  let nested = command
  for (let level = 0; level < depth; level++) nested = 'printf x "$(' + nested + ')"'
  return 'echo "$(' + nested + ')"'
}

function nestBacktickAroundDollarSubstitutions(command: string, dollarDepth: number): string {
  return 'echo `' + nestDollarSubstitutions(command, dollarDepth) + '`'
}

function nestInlineShells(command: string, depth: number): string {
  let nested = command
  for (let level = 0; level < depth; level++) nested = `bash -c ${JSON.stringify(nested)}`
  return nested
}

describe('assessRisk', () => {
  describe('HIGH risk', () => {
    it('native git push and pull require confirmation', () => {
      expect(assessRisk('git', { action: 'push' }, ctx())?.requiresConfirmation).toBe(true)
      expect(assessRisk('git', { action: 'push', force: true }, ctx())?.matchedRule).toBe('git:force-push')
      expect(assessRisk('git', { action: 'pull' }, ctx())?.requiresConfirmation).toBe(true)
    })
    it('rm -rf /tmp → HIGH, requires confirmation', () => {
      const r = assessRisk('shell', { command: 'rm -rf /tmp' }, ctx())
      expect(r).not.toBeNull()
      expect(r!.level).toBe('high')
      expect(r!.requiresConfirmation).toBe(true)
    })

    it('git push --force → HIGH, requires confirmation', () => {
      const r = assessRisk('shell', { command: 'git push --force' }, ctx())
      expect(r).not.toBeNull()
      expect(r!.level).toBe('high')
      expect(r!.requiresConfirmation).toBe(true)
    })

    it('git reset --hard → HIGH, requires confirmation', () => {
      const r = assessRisk('shell', { command: 'git reset --hard' }, ctx())
      expect(r).not.toBeNull()
      expect(r!.level).toBe('high')
      expect(r!.requiresConfirmation).toBe(true)
    })

    it('sudo apt install vim → HIGH, requires confirmation', () => {
      const r = assessRisk('shell', { command: 'sudo apt install vim' }, ctx())
      expect(r).not.toBeNull()
      expect(r!.level).toBe('high')
      expect(r!.requiresConfirmation).toBe(true)
    })

    it('npm install lodash → HIGH, requires confirmation', () => {
      const r = assessRisk('shell', { command: 'npm install lodash' }, ctx())
      expect(r).not.toBeNull()
      expect(r!.level).toBe('high')
      expect(r!.requiresConfirmation).toBe(true)
    })

    it('bun add zod → HIGH, requires confirmation', () => {
      const r = assessRisk('shell', { command: 'bun add zod' }, ctx())
      expect(r).not.toBeNull()
      expect(r!.level).toBe('high')
      expect(r!.requiresConfirmation).toBe(true)
    })

    it('write_file with .deepseek/config.json → HIGH', () => {
      const r = assessRisk('write_file', { path: '.deepseek/config.json' }, ctx())
      expect(r).not.toBeNull()
      expect(r!.level).toBe('high')
      expect(r!.requiresConfirmation).toBe(true)
    })

    it('edit_file with .deepseek/config.json → HIGH', () => {
      const r = assessRisk('edit_file', { path: '.deepseek/config.json' }, ctx())
      expect(r).not.toBeNull()
      expect(r!.matchedRule).toBe('edit:deepseek-config')
      expect(r!.requiresConfirmation).toBe(true)
    })

    it('write_file with _existingLineCount: 150 → HIGH (large_overwrite)', () => {
      const r = assessRisk('write_file', { path: 'src/foo.ts', _existingLineCount: 150 }, ctx())
      expect(r).not.toBeNull()
      expect(r!.level).toBe('high')
      expect(r!.matchedRule).toBe('write:large-overwrite')
      expect(r!.requiresConfirmation).toBe(true)
      expect(r!.description).toBe('Replaces the entire contents of an existing large file.')
    })

    it('chmod 777 /etc → HIGH', () => {
      const r = assessRisk('shell', { command: 'chmod 777 /etc' }, ctx())
      expect(r).not.toBeNull()
      expect(r!.level).toBe('high')
      expect(r!.requiresConfirmation).toBe(true)
    })

    it('systemctl restart nginx → HIGH', () => {
      const r = assessRisk('shell', { command: 'systemctl restart nginx' }, ctx())
      expect(r).not.toBeNull()
      expect(r!.level).toBe('high')
      expect(r!.requiresConfirmation).toBe(true)
    })

    it('curl and wget are HIGH network capabilities', () => {
      for (const command of ['curl https://example.invalid', 'wget https://example.invalid']) {
        const r = assessRisk('shell', { command }, ctx({ config: { enabled: false } }))
        expect(r?.matchedRule).toBe('shell:network')
        expect(r?.level).toBe('high')
        expect(r?.requiresConfirmation).toBe(true)
      }
    })
  })

  it('describes Browser batch uploads as file-content transmission', () => {
    const result = assessRisk('browser', {
      action: 'batch',
      steps: [{ action: 'upload', ref: 'file-input', paths: ['report.txt'] }],
      __origin: 'https://public.example',
    }, ctx())

    expect(result?.matchedRule).toBe('browser:transmit')
    expect(result?.description).toContain('Uploading sends file contents to https://public.example')
  })

  describe('MEDIUM risk', () => {
    it('git push origin main is HIGH network risk', () => {
      const r = assessRisk('shell', { command: 'git push origin main' }, ctx())
      expect(r).not.toBeNull()
      expect(r!.level).toBe('high')
      expect(r!.matchedRule).toBe('shell:network')
      expect(r!.requiresConfirmation).toBe(true)
    })

    it('git push origin main remains HIGH for subagents', () => {
      const r = assessRisk('shell', { command: 'git push origin main' }, ctx({ isSubAgent: true }))
      expect(r).not.toBeNull()
      expect(r!.level).toBe('high')
      expect(r!.requiresConfirmation).toBe(true)
    })

    it('git commit -m "test" → MEDIUM, no confirmation for main agent', () => {
      const r = assessRisk('shell', { command: 'git commit -m "test"' }, ctx())
      expect(r).not.toBeNull()
      expect(r!.level).toBe('medium')
      expect(r!.requiresConfirmation).toBe(false)
    })

    it('git commit -m "test" → MEDIUM, requires confirmation if subagent', () => {
      const r = assessRisk('shell', { command: 'git commit -m "test"' }, ctx({ isSubAgent: true }))
      expect(r).not.toBeNull()
      expect(r!.level).toBe('medium')
      expect(r!.requiresConfirmation).toBe(true)
    })

    it('write_file with package.json → MEDIUM, no confirmation for main agent', () => {
      const r = assessRisk('write_file', { path: 'package.json' }, ctx())
      expect(r).not.toBeNull()
      expect(r!.level).toBe('medium')
      expect(r!.requiresConfirmation).toBe(false)
    })

    it('write_file with package.json → MEDIUM, requires confirmation if subagent', () => {
      const r = assessRisk('write_file', { path: 'package.json' }, ctx({ isSubAgent: true }))
      expect(r).not.toBeNull()
      expect(r!.level).toBe('medium')
      expect(r!.requiresConfirmation).toBe(true)
    })

    it('write_file with tsconfig.json → MEDIUM, no confirmation for main agent', () => {
      const r = assessRisk('write_file', { path: 'tsconfig.json' }, ctx())
      expect(r).not.toBeNull()
      expect(r!.level).toBe('medium')
      expect(r!.requiresConfirmation).toBe(false)
    })

    it('write_file with tsconfig.json → MEDIUM, requires confirmation if subagent', () => {
      const r = assessRisk('write_file', { path: 'tsconfig.json' }, ctx({ isSubAgent: true }))
      expect(r).not.toBeNull()
      expect(r!.level).toBe('medium')
      expect(r!.requiresConfirmation).toBe(true)
    })

    it('write with recentWriteCount >= 3 → MEDIUM (burst)', () => {
      const r = assessRisk('write_file', { path: 'src/x.ts' }, ctx({ recentWriteCount: 3 }))
      expect(r).not.toBeNull()
      expect(r!.level).toBe('medium')
      expect(r!.matchedRule).toBe('write:burst')
    })

    it('burst → requires confirmation only if subagent', () => {
      const noConfirm = assessRisk('write_file', { path: 'src/x.ts' }, ctx({ recentWriteCount: 3 }))
      expect(noConfirm!.requiresConfirmation).toBe(false)

      const confirm = assessRisk('write_file', { path: 'src/x.ts' }, ctx({ recentWriteCount: 3, isSubAgent: true }))
      expect(confirm!.requiresConfirmation).toBe(true)
    })
  })

  describe('no match (null)', () => {
    it('git status → null', () => {
      expect(assessRisk('shell', { command: 'git status' }, ctx())).toBeNull()
    })

    it('git log --oneline → null', () => {
      expect(assessRisk('shell', { command: 'git log --oneline' }, ctx())).toBeNull()
    })

    it('ls -la → null', () => {
      expect(assessRisk('shell', { command: 'ls -la' }, ctx())).toBeNull()
    })

    it('bun test → null', () => {
      expect(assessRisk('shell', { command: 'bun test' }, ctx())).toBeNull()
    })

    it('read_file with any path → null', () => {
      expect(assessRisk('read_file', { path: '/etc/passwd' }, ctx())).toBeNull()
    })

    it('cat src/index.ts → null', () => {
      expect(assessRisk('shell', { command: 'cat src/index.ts' }, ctx())).toBeNull()
    })
  })

  describe('config overrides', () => {
    it('cannot downgrade a mandatory default high-risk rule', () => {
      const config = {
        rules: [{ id: 'shell:chmod', level: 'medium' as const, tool: 'shell', pattern: 'chmod *' }],
      }
      const r = assessRisk('shell', { command: 'chmod 644 file.txt' }, ctx({ config }))
      expect(r).not.toBeNull()
      expect(r!.level).toBe('high')
    })

    it('cannot disable or change the matcher of a mandatory default high-risk rule', () => {
      const config = {
        rules: [{ id: 'shell:chmod', enabled: false, level: 'medium' as const, tool: 'read_file', pattern: 'never *' }],
      }
      const r = assessRisk('shell', { command: 'chmod 644 file.txt' }, ctx({ config }))
      expect(r?.level).toBe('high')
      expect(r?.matchedRule).toBe('shell:chmod')
    })

    it('enabled: false disables optional checks but keeps high-risk rules mandatory', () => {
      const config = { enabled: false }
      expect(assessRisk('shell', { command: 'rm -rf /' }, ctx({ config }))?.level).toBe('high')
      expect(assessRisk('shell', { command: 'sudo reboot' }, ctx({ config }))?.level).toBe('high')
      expect(assessRisk('write_file', { path: '.deepseek/config.json' }, ctx({ config }))?.level).toBe('high')
      expect(assessRisk('shell', { command: 'git commit -m ok' }, ctx({ config }))).toBeNull()
    })

    it('custom threshold: largeFileLines: 200 → 150 lines does not trigger', () => {
      const config = { thresholds: { largeFileLines: 200 } }
      const r = assessRisk('write_file', { path: 'src/foo.ts', _existingLineCount: 150 }, ctx({ config }))
      // Should not match large_overwrite since 150 < 200
      // But might match burst or other rules — check it's not large_overwrite
      if (r !== null) {
        expect(r.matchedRule).not.toBe('write:large-overwrite')
      }
    })

    it('custom threshold: largeFileLines: 200 → 250 lines does trigger', () => {
      const config = { thresholds: { largeFileLines: 200 } }
      const r = assessRisk('write_file', { path: 'src/foo.ts', _existingLineCount: 250 }, ctx({ config }))
      expect(r).not.toBeNull()
      expect(r!.matchedRule).toBe('write:large-overwrite')
      expect(r!.level).toBe('high')
    })
  })

  describe('edge cases', () => {
    it('command with extra whitespace: "  rm  -rf  /" → matches HIGH', () => {
      const r = assessRisk('shell', { command: '  rm  -rf  /' }, ctx())
      expect(r).not.toBeNull()
      expect(r!.level).toBe('high')
      expect(r!.requiresConfirmation).toBe(true)
    })

    it('DEFAULT_RISK_RULES is a non-empty array', () => {
      expect(Array.isArray(DEFAULT_RISK_RULES)).toBe(true)
      expect(DEFAULT_RISK_RULES.length).toBeGreaterThan(0)
    })

    it('unknown tool returns null', () => {
      expect(assessRisk('unknown_tool', { foo: 'bar' }, ctx())).toBeNull()
    })

    it('shell with no command arg returns null', () => {
      expect(assessRisk('shell', {}, ctx())).toBeNull()
    })

    it('write_file with no path arg still checks conditions', () => {
      // large_overwrite checks _existingLineCount regardless of path
      const r = assessRisk('write_file', { _existingLineCount: 200 }, ctx())
      expect(r).not.toBeNull()
      expect(r!.matchedRule).toBe('write:large-overwrite')
    })
  })

  describe('specificity over level', () => {
    it('npm install --save-dev remains HIGH because package changes require approval', () => {
      const r = assessRisk('shell', { command: 'npm install --save-dev lodash' }, ctx())
      expect(r).not.toBeNull()
      expect(r!.level).toBe('high')
      expect(r!.matchedRule).toBe('shell:package-install')
      expect(r!.description).toContain('changes project dependencies and lockfiles')
      expect(r!.description).toContain('lifecycle scripts disabled')
    })

    it('bun add -d remains HIGH because package changes require approval', () => {
      const r = assessRisk('shell', { command: 'bun add -d vitest' }, ctx())
      expect(r).not.toBeNull()
      expect(r!.level).toBe('high')
      expect(r!.matchedRule).toBe('shell:package-install')
    })

    it('npm install lodash (without --save-dev) is still HIGH', () => {
      const r = assessRisk('shell', { command: 'npm install lodash' }, ctx())
      expect(r).not.toBeNull()
      expect(r!.level).toBe('high')
      expect(r!.matchedRule).toBe('shell:package-install')
    })
  })

  describe('false positive fixes', () => {
    it('cat deploy-notes.md is NOT high risk', () => {
      const r = assessRisk('shell', { command: 'cat deploy-notes.md' }, ctx())
      expect(r).toBeNull()
    })

    it('git push --follow-tags is HIGH network risk (not force push)', () => {
      const r = assessRisk('shell', { command: 'git push --follow-tags' }, ctx())
      expect(r).not.toBeNull()
      expect(r!.level).toBe('high')
      expect(r!.matchedRule).toBe('shell:network')
    })

    it('git push -f is still HIGH', () => {
      const r = assessRisk('shell', { command: 'git push -f origin main' }, ctx())
      expect(r).not.toBeNull()
      expect(r!.level).toBe('high')
    })
  })
})


it('classifies native Git transport actions as network capability with mandatory confirmation', () => {
  for (const action of ['push', 'pull']) {
    expect(hasNetworkCapability('git', { action })).toBe(true)
    expect(assessRisk('git', { action }, ctx({ config: { enabled: false } }))?.requiresConfirmation).toBe(true)
  }
  expect(hasNetworkCapability('git', { action: 'status' })).toBe(false)
})

describe('package installation shell effects', () => {
  const commands = [
    'npm ci',
    'npm it --offline',
    'npm install-test --offline',
    'npm cit --offline',
    'npm clean-install-test --offline',
    'npm clean-install --offline',
    'npm update --offline',
    'pnpm update --offline',
    'pnpm up --offline',
    'yarn up --offline',
    'yarn upgrade --offline',
    'bun update --offline',
    'bun up --offline',
    "npm 'install' --ignore-scripts",
    'cd app && pnpm install',
    'yarn add lodash',
    'bun install',
    'python3 -m pip install requests',
    'uv sync',
    'cargo add serde',
    'go get example.com/module',
    'composer install',
    'brew install jq',
    'npx --yes create-vite',
    'npm --prefix app ci',
    'bun --cwd app install',
    'cargo --manifest-path Cargo.toml add serde',
    'python3 -m pip --disable-pip-version-check install requests',
    'env CI=1 /usr/bin/npm ci',
    '/usr/bin/env npm ci',
    'env -S "npm install pkg"',
    'env -S npm install pkg',
    "bash <<'EOF'\nnpm install pkg\nEOF",
    "sh <<'EOF'\nnpm install pkg\nEOF",
    "bash -s <<'EOF'\nnpm install pkg\nEOF",
    "bash -s payload <<'EOF'\nnpm install pkg\nEOF",
    "env -S bash -s payload <<'EOF'\nnpm install pkg\nEOF",
    "env -S bash <<'EOF'\nnpm install pkg\nEOF",
    "bash <<< 'npm install pkg'",
    "bash -s payload <<< 'npm install pkg'",
    "env -S bash -s payload <<< 'npm install pkg'",
    "sh <<< 'npm install pkg'",
    "bash --noprofile -c 'npm install pkg'",
    "bash -o pipefail -c 'npm install pkg'",
    'env FOO=1 sudo -u root npm install pkg',
    "eval 'npm install pkg'",
    'npm \\\n install pkg',
    'echo ready\nyarn install',
    'echo $(bun install)',
    'echo `printf x "\\`npm install\\`"`',
    "bash -c 'bun install'",
    'if true; then npm install ./fixtures/local-package; fi',
    'if npm install ./fixtures/local-package; then echo done; fi',
    'if false; then :; else corepack pnpm install; fi',
    'while npm install ./fixtures/local-package; do break; done',
    '(npm install ./fixtures/local-package)',
    '{ npm install ./fixtures/local-package; }',
    'case x in x) npm install ./fixtures/local-package ;; esac',
    'for x in a; do bun install; done',
    "'corepack' pnpm install",
    'env -u UNUSED corepack pnpm install',
    "sh -c 'corepack pnpm install' --",
    "sh -ec 'corepack pnpm install'",
  ]

  for (const command of commands) {
    it(`${command} requires approval and explicit network access`, () => {
      expect(hasNetworkCapability('shell', { command })).toBe(true)
      expect(assessRisk('shell', { command }, ctx({ config: { enabled: false } }))).toMatchObject({
        level: 'high',
        matchedRule: 'shell:package-install',
        requiresConfirmation: true,
      })
    })
  }

  it('consumes sudo option values before detecting package installation', () => {
    for (const command of [
      'sudo -T 30 npm install pkg',
      'sudo --command-timeout 30 npm install pkg',
      'sudo -r system_u:system_r_t -t container_t -T 30 npm install pkg',
      'sudo --role system_u:system_r_t --type container_t --command-timeout 30 npm install pkg',
    ]) {
      expect(hasNetworkCapability('shell', { command }), command).toBe(true)
      const risk = assessRisk('shell', { command }, ctx({ config: { enabled: false } }))
      expect(risk, command).toMatchObject({ level: 'high', matchedRule: 'shell:sudo', requiresConfirmation: true })
      expect(risk?.description).toContain('Package installation or update changes project dependencies and lockfiles')
    }
  })

  for (const command of [
    'CI=true npm install pkg',
    'FOO=1 bun add x',
    'CI="true" npm install pkg',
    "FOO='test value' bun add x",
    'CI=x" " npm install pkg',
    'NOTE=two\\ words corepack pnpm install',
    "CI=$(printf 'x y') npm install pkg",
    `CI=$(printf 'x' "$(printf 'y')") npm install pkg`,
  ]) {
    it(`${command} requires approval and explicit network access`, () => {
      expect(hasNetworkCapability('shell', { command })).toBe(true)
      expect(assessRisk('shell', { command }, ctx({ config: { enabled: false } }))).toMatchObject({
        level: 'high',
        matchedRule: 'shell:package-install',
        requiresConfirmation: true,
      })
    })
  }

  it('does not classify package-manager names in ordinary quoted text as installation', () => {
    for (const command of [
      "printf '%s' 'npm install'",
      'grep "pnpm add" README.md',
      "printf '%s' 'then npm install'",
      "printf '%s' 'literal; corepack pnpm install'",
      "cat <<'EOF'\nnpm install pkg\nEOF",
      'cat <<EOF\nnpm install pkg\nEOF',
    ]) {
      expect(hasNetworkCapability('shell', { command })).toBe(false)
      expect(assessRisk('shell', { command }, ctx())).toBeNull()
    }
  })
})

describe('package lifecycle-script execution', () => {
  const commands = [
    'npm rebuild',
    'npm rb',
    'pnpm rebuild',
    'yarn rebuild',
    'npm -- rebuild',
    'npm --prefix app rebuild --foreground-scripts',
    'env CI=1 /usr/bin/npm --workspace packages/app rb package-name',
    'env -S "npm rebuild"',
    "bash <<'EOF'\nnpm rebuild\nEOF",
    "bash -s <<'EOF'\nnpm rebuild\nEOF",
    "bash <<< 'npm rebuild'",
    "bash --noprofile -c 'npm rebuild'",
    'env FOO=1 sudo -u root npm rebuild',
    "eval 'npm rebuild'",
    'npm \\\n rebuild',
    'if true; then npm rebuild package-name; fi',
    "bash -ec 'npm rebuild --ignore-scripts'",
    'echo "$(npm rebuild)"',
    'value="$(npm rebuild)"',
    'echo `printf x "\\`npm rebuild\\`"`',
  ]

  for (const command of commands) {
    it(`${command} requires high-risk consent without enabling network`, () => {
      expect(hasPackageLifecycleScriptExecution(command)).toBe(true)
      expect(hasNetworkCapability('shell', { command })).toBe(false)
      expect(assessRisk('shell', { command }, ctx({ config: { enabled: false } }))).toMatchObject({
        level: 'high',
        matchedRule: 'shell:package-lifecycle',
        requiresConfirmation: true,
      })
    })
  }

  it('does not classify quoted npm lifecycle text as executable', () => {
    for (const command of [
      "printf '%s' 'npm rebuild'",
      "printf '%s' '$(npm rebuild)'",
      'echo "\\$(npm rebuild)"',
      'echo \\`npm rebuild\\`',
      "printf '%s' '`npm rebuild`'",
      'echo ready # `npm rebuild`',
      "cat <<'EOF'\n`npm rebuild`\nEOF",
      "cat <<-'EOF'\n\t`npm rebuild`\n\tEOF",
      'cat <<EOF\nnpm rebuild\nEOF',
      "printf '%s' 'npm \\\n rebuild'",
    ]) {
      expect(hasPackageLifecycleScriptExecution(command)).toBe(false)
      expect(hasNetworkCapability('shell', { command })).toBe(false)
      expect(assessRisk('shell', { command }, ctx())).toBeNull()
    }
  })

  it('still detects command substitutions expanded from unquoted heredocs', () => {
    for (const command of [
      'cat <<EOF\n$(npm rebuild)\nEOF',
      'cat <<EOF\n`npm rebuild`\nEOF',
      'cat <<-EOF\n\t$(npm rebuild)\n\tEOF',
    ]) {
      expect(hasPackageLifecycleScriptExecution(command), command).toBe(true)
      expect(hasNetworkCapability('shell', { command }), command).toBe(false)
      expect(assessRisk('shell', { command }, ctx())).toMatchObject({
        level: 'high',
        matchedRule: 'shell:package-lifecycle',
        requiresConfirmation: true,
      })
    }
  })

  it('ignores network-looking text in comments and heredoc bodies', () => {
    for (const command of [
      'echo ready # curl https://example.test/data',
      "cat <<'EOF'\nhttps://example.test/data\ncurl https://example.test/data\nEOF",
      'cat <<EOF\nhttps://example.test/data\ncurl https://example.test/data\nEOF',
    ]) {
      expect(hasNetworkCapability('shell', { command }), command).toBe(false)
      expect(assessRisk('shell', { command }, ctx()), command).toBeNull()
    }
  })

  it('detects network commands expanded from unquoted heredocs', () => {
    for (const command of [
      'cat <<EOF\n$(curl https://example.test/data)\nEOF',
      'cat <<EOF\n`curl https://example.test/data`\nEOF',
    ]) {
      expect(hasNetworkCapability('shell', { command }), command).toBe(true)
      expect(assessRisk('shell', { command }, ctx())).toMatchObject({
        level: 'high',
        matchedRule: 'shell:network',
        requiresConfirmation: true,
      })
    }
  })

  it('fails closed when lifecycle commands exceed the substitution inspection depth', () => {
    const nestedCommand = (depth: number) => {
      let inner = 'npm rebuild'
      for (let level = 0; level < depth; level++) inner = `printf x "$(${inner})"`
      return `echo "$(${inner})"`
    }

    for (const command of [nestedCommand(3), nestBacktickAroundDollarSubstitutions('npm rebuild', 2)]) {
      expect(hasPackageLifecycleScriptExecution(command), command).toBe(true)
      expect(assessRisk('shell', { command }, ctx()), command).toMatchObject({
        level: 'high',
        matchedRule: 'shell:package-lifecycle',
        requiresConfirmation: true,
      })
    }

    const benignNestedCommand = nestDollarSubstitutions('printf benign', 1)
    expect(hasPackageLifecycleScriptExecution(benignNestedCommand)).toBe(false)
    expect(assessRisk('shell', { command: benignNestedCommand }, ctx())).toBeNull()
  })
})

describe('package script execution', () => {
  const commands = [
    'npm run build',
    'npm run-script postinstall',
    'npm run -- build',
    'npm "run" check',
    'npm test',
    'npm start',
    'corepack npm test',
    'npm --prefix app run test',
    'npm --workspace packages/app run lint',
    'pnpm run build',
    'pnpm --filter app run test',
    'pnpm test',
    'pnpm watch',
    'time -p pnpm watch',
    '/usr/bin/time -p pnpm watch',
    'pnpm --filter app preview',
    'corepack pnpm --filter app release',
    'echo "$(pnpm generate)"',
    'yarn run deploy',
    'yarn --cwd app run test',
    'yarn test',
    'time -p yarn release',
    'yarn deploy --dry-run',
    'yarn --cwd app preview',
    'corepack yarn --cwd app release',
    "bash -s <<'EOF'\nyarn deploy\nEOF",
    'bun run build',
    'bun --cwd app run test',
    'bun dev',
    'bun --filter app preview',
    'corepack pnpm run generate',
    'env CI=1 /usr/bin/npm run check',
    'npm run "$SCRIPT"',
    'cd app && pnpm run build',
    "bash -c 'npm run build'",
    "bash -s <<'EOF'\nnpm run build\nEOF",
    'value="$(yarn run generate)"',
  ]

  for (const command of commands) {
    it(`${command} requires fresh high-risk approval without assuming network`, () => {
      expect(hasPackageScriptExecution(command), command).toBe(true)
      expect(hasNetworkCapability('shell', { command }), command).toBe(false)
      expect(assessRisk('shell', { command }, ctx({ config: { enabled: false } })), command).toMatchObject({
        level: 'high',
        requiresConfirmation: true,
      })
      expect(assessRisk('shell', { command }, ctx({ config: { enabled: false } }))?.description, command).toContain('Package scripts can execute project-defined code')
    })
  }

  it('fails closed on a computed direct script name', () => {
    const command = 'yarn "$SCRIPT"'
    expect(hasPackageScriptExecution(command)).toBe(true)
    expect(assessRisk('shell', { command }, ctx())).toMatchObject({ level: 'high', requiresConfirmation: true })
  })

  it('requires confirmation for path-like pnpm and Yarn shorthand names', () => {
    for (const command of [
      'pnpm ./scripts/task.js',
      'pnpm scripts/build',
      String.raw`yarn .\scripts\build`,
      'yarn packages/app:build',
      'corepack pnpm ./scripts/task.js',
      'cd app && yarn ./scripts/build',
    ]) {
      expect(hasPackageScriptExecution(command), command).toBe(true)
      expect(hasNetworkCapability('shell', { command }), command).toBe(false)
      expect(assessRisk('shell', { command }, ctx()), command).toMatchObject({
        level: 'high',
        matchedRule: 'shell:package-script',
        requiresConfirmation: true,
      })
    }
  })

  it('detects direct shorthand through native Windows package-manager executable paths', () => {
    for (const command of [
      String.raw`C:\tools\pnpm.cmd scripts\build`,
      String.raw`C:\tools\yarn.cmd scripts\release`,
      String.raw`C:\tools\corepack.cmd pnpm scripts\build`,
    ]) {
      expect(hasPackageScriptExecution(command), command).toBe(true)
      expect(hasNetworkCapability('shell', { command }), command).toBe(false)
      expect(assessRisk('shell', { command }, ctx()), command).toMatchObject({
        level: 'high',
        matchedRule: 'shell:package-script',
        requiresConfirmation: true,
      })
    }
  })

  it('does not classify package script text that is literal, commented, or document input', () => {
    for (const command of [
      "printf '%s' 'npm run build'",
      'echo "pnpm run build"',
      'echo ready # yarn run build',
      'echo ready # yarn deploy',
      "cat <<'EOF'\nnpm run build\nEOF",
      "cat <<'EOF'\nyarn deploy\nEOF",
      'cat <<EOF\nbun run build\nEOF',
      'npm run',
      'npm --version',
      'pnpm --version',
      'yarn --version',
      'time -p echo "yarn release"',
      'time -p pnpm deploy',
      '/usr/bin/time -p echo "yarn release"',
      '/usr/bin/time -p pnpm deploy',
    ]) {
      expect(hasPackageScriptExecution(command), command).toBe(false)
      expect(hasNetworkCapability('shell', { command }), command).toBe(false)
      expect(assessRisk('shell', { command }, ctx()), command).toBeNull()
    }
  })

  it('excludes package-manager built-ins, options, and direct file paths from shorthand detection', () => {
    for (const command of [
      'pnpm --version',
      'pnpm deploy',
      'yarn --help',
      'yarn workspaces list',
      'bun --version',
      'bun build src/index.ts',
      'bun test',
      'bun ./scripts/release.ts',
      'bun src/index.ts',
    ]) {
      expect(hasPackageScriptExecution(command), command).toBe(false)
      expect(hasNetworkCapability('shell', { command }), command).toBe(false)
      expect(assessRisk('shell', { command }, ctx()), command).toBeNull()
    }
  })
})

describe('package install lifecycle policy', () => {
  for (const command of [
    'npm ci --ignore-scripts',
    'npm clean-install --ignore-scripts',
    'npm update --ignore-scripts',
    'npm --ignore-scripts update',
    "npm 'install' --ignore-scripts",
    'npm --ignore-scripts ci',
    'npm install package --ignore-scripts',
    'pnpm install --ignore-scripts',
    'pnpm add package --ignore-scripts',
    'pnpm update --ignore-scripts',
    'pnpm up --ignore-scripts',
    'bun install --ignore-scripts',
    'bun add package --ignore-scripts',
    'bun update --ignore-scripts',
    'bun up --ignore-scripts',
  ]) {
    it(`allows ${command} with lifecycle scripts disabled`, () => {
      expect(packageInstallLifecyclePolicy(command)).toBe('safe')
    })
  }

  it('allows Yarn Classic only with ignored scripts and a pinned v1 release', () => {
    expect(packageInstallLifecyclePolicy('yarn install --ignore-scripts', 'yarn@1.22.22')).toBe('safe')
    expect(packageInstallLifecyclePolicy('yarn --ignore-scripts install', 'yarn@1.22.22')).toBe('safe')
    expect(packageInstallLifecyclePolicy('yarn install', 'yarn@1.22.22')).toBe('blocked')
    expect(packageInstallLifecyclePolicy('yarn install --ignore-scripts')).toBe('blocked')
    expect(packageInstallLifecyclePolicy('yarn install --mode=skip-build', 'yarn@1.22.22')).toBe('blocked')
  })

  it('blocks Yarn Berry because skip-build does not prove that every install hook is disabled', () => {
    expect(packageInstallLifecyclePolicy('yarn install --mode=skip-build', 'yarn@4.6.0')).toBe('blocked')
    expect(packageInstallLifecyclePolicy('yarn --mode=skip-build install', 'yarn@4.6.0')).toBe('blocked')
    expect(packageInstallLifecyclePolicy('yarn upgrade --mode=skip-build', 'yarn@2.4.3+sha224.abc')).toBe('blocked')
    expect(packageInstallLifecyclePolicy('yarn install --mode=skip-build')).toBe('blocked')
    expect(packageInstallLifecyclePolicy('yarn install --ignore-scripts', 'yarn@4.6.0')).toBe('blocked')
    expect(packageInstallLifecyclePolicy('yarn install --mode=skip-build --mode=update-lockfile', 'yarn@4.6.0')).toBe('blocked')
  })

  it('allows Yarn Classic update commands only with ignored scripts and a pinned v1 release', () => {
    expect(packageInstallLifecyclePolicy('yarn up --ignore-scripts', 'yarn@1.22.22')).toBe('safe')
    expect(packageInstallLifecyclePolicy('yarn upgrade --ignore-scripts', 'yarn@1.22.22')).toBe('safe')
    expect(packageInstallLifecyclePolicy('yarn up', 'yarn@1.22.22')).toBe('blocked')
    expect(packageInstallLifecyclePolicy('yarn upgrade', 'yarn@1.22.22')).toBe('blocked')
    expect(packageInstallLifecyclePolicy('yarn up --ignore-scripts')).toBe('blocked')
  })

  it('blocks missing, overridden, wrapped, compound, and unsupported install forms', () => {
    for (const command of [
      'npm install package',
      'npm it --ignore-scripts',
      'npm install-test --ignore-scripts',
      'npm cit --ignore-scripts',
      'npm clean-install-test --ignore-scripts',
      'npm clean-install',
      'npm install package --ignore-scripts=false',
      'npm install package --ignore-scripts false',
      'npm install --ignore-scripts --no-ignore-scripts',
      'npm install --no-ignore-scripts --ignore-scripts',
      'npm install --ignore-scripts --ignore-scripts=false',
      'npm install --ignore-scripts=false --ignore-scripts',
      'npm --prefix app ci --ignore-scripts',
      'npm update --offline',
      'pnpm update --offline',
      'pnpm up --offline',
      'yarn up --offline',
      'yarn upgrade --offline',
      'bun update --offline',
      'bun up --offline',
      'corepack pnpm install --ignore-scripts',
      'echo ready && npm install --ignore-scripts',
      'npm install --ignore-scripts $(printf package)',
      'npx --yes create-vite',
      'pip install package',
    ]) {
      expect(packageInstallLifecyclePolicy(command), command).toBe('blocked')
    }
    expect(packageInstallLifecyclePolicy('printf npm install')).toBe('not-install')
  })

  it('blocks installs hidden beyond the substitution inspection depth', () => {
    for (const command of [
      nestDollarSubstitutions('npm install --ignore-scripts', 3),
      nestBacktickAroundDollarSubstitutions('npm install --ignore-scripts', 2),
    ]) {
      expect(packageInstallLifecyclePolicy(command), command).toBe('blocked')
    }

    expect(packageInstallLifecyclePolicy(nestDollarSubstitutions('printf benign', 1))).toBe('not-install')
  })

  it('blocks package installs beyond the substitution inspection depth', () => {
    const command = nestDollarSubstitutions('npm install --ignore-scripts', 4)

    expect(packageInstallLifecyclePolicy(command)).toBe('blocked')
    expect(assessRisk('shell', { command }, ctx())).toMatchObject({
      level: 'high',
      matchedRule: 'shell:package-install',
      requiresConfirmation: true,
    })
  })

  it('blocks package installs hidden behind nested inline shell commands', () => {
    for (const command of [
      nestInlineShells('npm install --ignore-scripts', 2),
      nestInlineShells('npm install --ignore-scripts', 4),
    ]) {
      expect(packageInstallLifecyclePolicy(command), command).toBe('blocked')
      expect(hasNetworkCapability('shell', { command }), command).toBe(true)
      expect(assessRisk('shell', { command }, ctx()), command).toMatchObject({
        level: 'high',
        matchedRule: 'shell:package-install',
        requiresConfirmation: true,
      })
    }
  })

  it('fails closed for ANSI-C quoted and over-depth package-install wrappers', () => {
    const commands = [
      "bash -c $'npm install'",
      "bash -ec $'npm install'",
      "bash --noprofile -c $'npm install'",
      nestInlineShells("eval 'npm install --ignore-scripts'", 3),
      nestInlineShells("bash -s <<< 'npm install --ignore-scripts'", 3),
    ]

    expect(commands.map(command => packageInstallLifecyclePolicy(command))).toEqual(commands.map(() => 'blocked'))
    expect(commands.map(command => hasNetworkCapability('shell', { command }))).toEqual(commands.map(() => true))
    expect(commands.map(command => {
      const risk = assessRisk('shell', { command }, ctx())
      return risk && { level: risk.level, matchedRule: risk.matchedRule, requiresConfirmation: risk.requiresConfirmation }
    })).toEqual(commands.map(() => ({ level: 'high', matchedRule: 'shell:package-install', requiresConfirmation: true })))
  })

  it('keeps a direct inline-shell rebuild on the lifecycle-approval path', () => {
    const command = "bash -c 'npm rebuild'"

    expect(packageInstallLifecyclePolicy(command), command).toBe('not-install')
    expect(hasPackageLifecycleScriptExecution(command), command).toBe(true)
    expect(assessRisk('shell', { command }, ctx()), command).toMatchObject({
      level: 'high',
      matchedRule: 'shell:package-lifecycle',
      requiresConfirmation: true,
    })
  })

  it('detects package commands split across adjacent shell quotes', () => {
    const rebuild = "bash -c 'npm 'rebuild"
    expect(packageInstallLifecyclePolicy(rebuild), rebuild).toBe('not-install')
    expect(hasPackageLifecycleScriptExecution(rebuild), rebuild).toBe(true)
    expect(hasNetworkCapability('shell', { command: rebuild }), rebuild).toBe(false)
    expect(assessRisk('shell', { command: rebuild }, ctx()), rebuild).toMatchObject({
      level: 'high',
      matchedRule: 'shell:package-lifecycle',
      requiresConfirmation: true,
    })

    const install = "bash -c 'npm 'install --ignore-scripts"
    expect(packageInstallLifecyclePolicy(install), install).toBe('blocked')
    expect(hasNetworkCapability('shell', { command: install }), install).toBe(true)
    expect(assessRisk('shell', { command: install }, ctx()), install).toMatchObject({
      level: 'high',
      matchedRule: 'shell:package-install',
      requiresConfirmation: true,
    })
  })

  it('fails closed on a rebuild hidden beyond the inline-shell inspection depth', () => {
    const command = nestInlineShells('npm rebuild', 4)

    expect(packageInstallLifecyclePolicy(command), command).toBe('blocked')
    expect(assessRisk('shell', { command }, ctx()), command).toMatchObject({
      level: 'high',
      matchedRule: 'shell:package-install',
      requiresConfirmation: true,
    })
  })

  it('keeps deeply nested rebuild approvals separate from package-install rejection', () => {
    for (const manager of ['npm', 'pnpm', 'yarn']) {
      const command = nestDollarSubstitutions(`${manager} rebuild`, 3)
      expect(packageInstallLifecyclePolicy(command), command).toBe('not-install')
      expect(hasPackageLifecycleScriptExecution(command), command).toBe(true)
      expect(assessRisk('shell', { command }, ctx()), command).toMatchObject({
        level: 'high',
        matchedRule: 'shell:package-lifecycle',
        requiresConfirmation: true,
      })
    }

    expect(packageInstallLifecyclePolicy(nestDollarSubstitutions('npm install --ignore-scripts', 4))).toBe('blocked')
  })

  it('blocks package installs hidden in a deeply nested bash -s heredoc', () => {
    const script = "bash -s <<'EOF'\nnpm install --ignore-scripts\nEOF"
    const command = nestDollarSubstitutions(script, 5)

    expect(packageInstallLifecyclePolicy(command)).toBe('blocked')
    expect(assessRisk('shell', { command }, ctx())).toMatchObject({
      level: 'high',
      matchedRule: 'shell:package-install',
      requiresConfirmation: true,
    })
  })
})

describe('cloud mutation approval context', () => {
  it('explains that explicit selectors do not verify cloud identity or deployment plans', () => {
    const command = 'aws --profile production ec2 terminate-instances'
    expect(assessRisk('shell', { command }, ctx())).toMatchObject({
      level: 'high',
      matchedRule: 'shell:network',
      requiresConfirmation: true,
    })
    const description = assessRisk('shell', { command }, ctx())?.description ?? ''
    expect(description).toContain('does not verify the active identity')
    expect(description).toContain('does not verify the deployment plan or bind approval to it')
    expect(description).toContain('verify identity, destination, and plan before approving')
  })

  it('keeps implicit-context warnings distinct from explicit selectors', () => {
    const command = 'aws ec2 terminate-instances'
    const assessment = assessRisk('shell', { command }, ctx())
    expect(assessment).toMatchObject({ matchedRule: 'shell:cloud-target-implicit', level: 'high' })
    expect(assessment?.description).toContain('no literal provider context selector')
    expect(assessment?.description).toContain('or bind approval to a deployment plan')
  })

  it('requires approval when global options precede the cloud mutation verb', () => {
    for (const command of [
      'terraform -chdir=prod apply -auto-approve',
      'pulumi --stack production up --yes',
      'pulumi -s production up --yes',
      'pulumi -C /tmp up --yes',
      'pulumi --color never up --yes',
      'pulumi --verbose 3 up --yes',
      'pulumi -v 3 up --yes',
      'pulumi --profiling trace.out up',
      'pulumi --tracing file:trace up',
      'pulumi --otel-traces https://collector up',
      'pulumi --memprofilerate 1 up',
      'terraform \\\n apply -auto-approve',
      'env -S "aws ec2 terminate-instances --instance-ids i-123"',
      "bash <<'EOF'\naws ec2 terminate-instances --instance-ids i-123\nEOF",
      "bash -s payload <<'EOF'\naws ec2 terminate-instances --instance-ids i-123\nEOF",
      "env -S bash -s payload <<'EOF'\naws ec2 terminate-instances --instance-ids i-123\nEOF",
      "bash -s payload <<< 'aws ec2 terminate-instances --instance-ids i-123'",
      "env -S bash -s payload <<< 'aws ec2 terminate-instances --instance-ids i-123'",
    ]) {
      expect(hasNetworkCapability('shell', { command }), command).toBe(true)
      expect(assessRisk('shell', { command }, ctx()), command).toMatchObject({
        level: 'high',
        requiresConfirmation: true,
      })
    }
  })

  it('does not mistake Pulumi global option values for subcommands', () => {
    for (const command of [
      'pulumi --profiling up',
      'pulumi --tracing destroy',
      'pulumi --otel-traces delete',
      'pulumi --verbose apply',
      'pulumi -v remove',
      'pulumi --memprofilerate upgrade',
    ]) {
      expect(hasImplicitCloudMutationTarget(command), command).toBe(false)
      expect(hasNetworkCapability('shell', { command }), command).toBe(false)
      expect(assessRisk('shell', { command }, ctx()), command).toBeNull()
    }
  })

  it('ignores cloud command text in comments and heredoc bodies', () => {
    for (const command of [
      'echo ready # `aws ec2 terminate-instances`',
      "cat <<'EOF'\naws ec2 terminate-instances\nEOF",
      "cat <<-'EOF'\n\taws ec2 terminate-instances\n\tEOF",
      'cat <<EOF\naws ec2 terminate-instances\nEOF',
    ]) {
      expect(hasImplicitCloudMutationTarget(command), command).toBe(false)
      expect(hasNetworkCapability('shell', { command }), command).toBe(false)
      expect(assessRisk('shell', { command }, ctx()), command).toBeNull()
    }
  })

  it('inspects expanded cloud commands in unquoted heredocs', () => {
    const command = 'cat <<EOF\n$(aws ec2 terminate-instances)\nEOF'
    expect(hasImplicitCloudMutationTarget(command)).toBe(true)
    expect(assessRisk('shell', { command }, ctx())).toMatchObject({
      level: 'high',
      matchedRule: 'shell:cloud-target-implicit',
      requiresConfirmation: true,
    })
  })
})
