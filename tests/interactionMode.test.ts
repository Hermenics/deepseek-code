import { describe, it, expect } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { allTools } from '../src/tools/index.js'
import { Introspect } from '../src/tools/Introspect/Introspect.js'
import {
  nextMode,
  isBuildMode,
  isAutoMode,
  isReviewMode,
  canUseTool,
  canModelActivateMode,
  isDestructiveShell,
  isConfigWrite,
  getToolsForMode,
  DEFAULT_MODE,
  MODES,
  type InteractionMode,
} from '../src/ui/interactionMode.js'

type RestrictedMode = Exclude<InteractionMode, 'auto'>

const DOCUMENTED_MODE_TOOLS: Record<RestrictedMode, string[]> = {
  review: ['read_file', 'read_folder', 'glob', 'grep', 'lsp', 'web_fetch', 'introspect', 'todo', 'memory', 'git', 'workflow', 'get_goal', 'ask_user_questions'],
  plan: ['read_file', 'read_folder', 'glob', 'grep', 'lsp', 'web_fetch', 'introspect', 'todo', 'memory', 'git', 'workflow', 'get_goal', 'ask_user_questions', 'write_plan', 'submit_plan'],
  build: ['read_file', 'read_folder', 'glob', 'grep', 'lsp', 'web_fetch', 'introspect', 'todo', 'memory', 'git', 'workflow', 'get_goal', 'ask_user_questions', 'shell', 'write_file', 'edit_file', 'patch_file', 'update_knowledge', 'subagent', 'ask_agent', 'moa', 'update_goal'],
}

function documentedTools(content: string, mode: RestrictedMode): string[] {
  const label = `${mode[0]!.toUpperCase()}${mode.slice(1)}`
  const row = content.match(new RegExp(`^\\| ${label} \\| (.+) \\|$`, 'm'))?.[1]
  if (!row) throw new Error(`Missing ${label} tool-permissions row`)
  return row.split(',').map((tool) => tool.trim().replaceAll('`', '')).filter(Boolean)
}

describe('interactionMode', () => {
  describe('MODES', () => {
    it('should define plan, review, build, and auto', () => {
      expect(MODES).toEqual(['plan', 'review', 'build', 'auto'])
    })
  })

  describe('DEFAULT_MODE', () => {
    it('should have build as the default initial mode', () => {
      expect(DEFAULT_MODE).toBe('build')
    })
  })

  describe('nextMode()', () => {
    it('should return auto when current mode is build', () => {
      expect(nextMode('build')).toBe('auto')
    })

    it('should return plan when current mode is auto', () => {
      expect(nextMode('auto')).toBe('plan')
    })

    it('should return review when current mode is plan', () => {
      expect(nextMode('plan')).toBe('review')
    })

    it('should cycle plan → review → build → auto → plan', () => {
      let mode: InteractionMode = 'plan'
      mode = nextMode(mode) // review
      expect(mode).toBe('review')
      mode = nextMode(mode) // build
      expect(mode).toBe('build')
      mode = nextMode(mode) // auto
      expect(mode).toBe('auto')
      mode = nextMode(mode) // plan
      expect(mode).toBe('plan')
    })

    it('should return plan after 4 consecutive calls starting from plan (1 complete cycle)', () => {
      let mode: InteractionMode = 'plan'
      for (let i = 0; i < 4; i++) {
        mode = nextMode(mode)
      }
      expect(mode).toBe('plan')
    })
  })

  describe('isBuildMode()', () => {
    it('should return true for build', () => {
      expect(isBuildMode('build')).toBe(true)
    })

    it('should return false for plan', () => {
      expect(isBuildMode('plan')).toBe(false)
    })

    it('should return false for auto', () => {
      expect(isBuildMode('auto')).toBe(false)
    })
  })

  describe('isAutoMode()', () => {
    it('should return true for auto', () => {
      expect(isAutoMode('auto')).toBe(true)
    })

    it('should return false for build', () => {
      expect(isAutoMode('build')).toBe(false)
    })

    it('should return false for plan', () => {
      expect(isAutoMode('plan')).toBe(false)
    })
  })

  describe('isReviewMode()', () => {
    it('only returns true for review', () => {
      expect(isReviewMode('review')).toBe(true)
      expect(isReviewMode('build')).toBe(false)
      expect(isReviewMode('plan')).toBe(false)
      expect(isReviewMode('auto')).toBe(false)
    })
  })

  describe('canUseTool()', () => {
    describe('build mode', () => {
      it('should allow read_file', () => {
        expect(canUseTool('build', 'read_file')).toBe(true)
      })

      it('should allow web_fetch', () => {
        expect(canUseTool('build', 'web_fetch')).toBe(true)
      })

      it('should allow shell', () => {
        expect(canUseTool('build', 'shell')).toBe(true)
      })

      it('should allow write_file', () => {
        expect(canUseTool('build', 'write_file')).toBe(true)
      })

      it('should allow patch_file', () => {
        expect(canUseTool('build', 'patch_file')).toBe(true)
      })

      it('should allow edit_file, moa, and goal status updates', () => {
        expect(canUseTool('build', 'edit_file')).toBe(true)
        expect(canUseTool('build', 'moa')).toBe(true)
        expect(canUseTool('build', 'get_goal')).toBe(true)
        expect(canUseTool('build', 'update_goal')).toBe(true)
        expect(canUseTool('build', 'create_goal')).toBe(false)
      })

      it('should allow update_knowledge', () => {
        expect(canUseTool('build', 'update_knowledge')).toBe(true)
      })

      it('should allow MCP tools (contain __)', () => {
        expect(canUseTool('build', 'mcp__server__tool')).toBe(true)
      })

      it('should allow git', () => {
        expect(canUseTool('build', 'git')).toBe(true)
      })

      it('should allow subagent', () => {
        expect(canUseTool('build', 'subagent')).toBe(true)
      })

      it('should allow todo', () => {
        expect(canUseTool('build', 'todo')).toBe(true)
      })

      it('should allow memory', () => {
        expect(canUseTool('build', 'memory')).toBe(true)
      })
    })

    describe('auto mode', () => {
      it('should allow read_file', () => {
        expect(canUseTool('auto', 'read_file')).toBe(true)
      })

      it('should allow shell', () => {
        expect(canUseTool('auto', 'shell')).toBe(true)
      })

      it('should allow write_file', () => {
        expect(canUseTool('auto', 'write_file')).toBe(true)
      })

      it('should allow patch_file', () => {
        expect(canUseTool('auto', 'patch_file')).toBe(true)
      })

      it('should allow update_knowledge', () => {
        expect(canUseTool('auto', 'update_knowledge')).toBe(true)
      })

      it('should allow MCP tools (contain __)', () => {
        expect(canUseTool('auto', 'mcp__server__tool')).toBe(true)
      })

      it('should allow any arbitrary tool', () => {
        expect(canUseTool('auto', 'anything_else')).toBe(true)
      })
    })

    describe('plan mode', () => {
      it('should allow read_file', () => {
        expect(canUseTool('plan', 'read_file')).toBe(true)
      })

      it('should allow web_fetch', () => {
        expect(canUseTool('plan', 'web_fetch')).toBe(true)
      })

      it('should allow glob', () => {
        expect(canUseTool('plan', 'glob')).toBe(true)
      })

      it('should allow grep', () => {
        expect(canUseTool('plan', 'grep')).toBe(true)
      })

      it('should allow git', () => {
        expect(canUseTool('plan', 'git')).toBe(true)
      })

      it('should allow introspect', () => {
        expect(canUseTool('plan', 'introspect')).toBe(true)
      })

      it('should allow todo', () => {
        expect(canUseTool('plan', 'todo')).toBe(true)
      })

      it('should block subagent because plan may only write its designated plan', () => {
        expect(canUseTool('plan', 'subagent')).toBe(false)
      })

      it('should allow memory', () => {
        expect(canUseTool('plan', 'memory')).toBe(true)
      })

      it('should block write_file', () => {
        expect(canUseTool('plan', 'write_file')).toBe(false)
      })

      it('should block patch_file', () => {
        expect(canUseTool('plan', 'patch_file')).toBe(false)
      })

      it('should block shell', () => {
        expect(canUseTool('plan', 'shell')).toBe(false)
      })

      it('should block update_knowledge', () => {
        expect(canUseTool('plan', 'update_knowledge')).toBe(false)
      })

      it('should block MCP tools (contain __)', () => {
        expect(canUseTool('plan', 'mcp__server__tool')).toBe(false)
      })

      it('should allow write_plan', () => {
        expect(canUseTool('plan', 'write_plan')).toBe(true)
      })

      it('should allow get_goal but block edit_file and goal mutations', () => {
        expect(canUseTool('plan', 'get_goal')).toBe(true)
        expect(canUseTool('plan', 'edit_file')).toBe(false)
        expect(canUseTool('plan', 'create_goal')).toBe(false)
        expect(canUseTool('plan', 'update_goal')).toBe(false)
      })
    })

    describe('review mode', () => {
      it('allows inspection tools and blocks mutation tools', () => {
        expect(canUseTool('review', 'read_file')).toBe(true)
        expect(canUseTool('review', 'grep')).toBe(true)
        expect(canUseTool('review', 'git')).toBe(true)
        expect(canUseTool('review', 'shell')).toBe(false)
        expect(canUseTool('review', 'write_file')).toBe(false)
        expect(canUseTool('review', 'patch_file')).toBe(false)
        expect(canUseTool('review', 'subagent')).toBe(false)
        expect(canUseTool('review', 'get_goal')).toBe(true)
        expect(canUseTool('review', 'edit_file')).toBe(false)
      })
    })

    describe('write_plan availability', () => {
      it('should be allowed in plan mode', () => {
        expect(canUseTool('plan', 'write_plan')).toBe(true)
      })

      it('should not be allowed in build mode', () => {
        expect(canUseTool('build', 'write_plan')).toBe(false)
      })

      it('should be allowed in auto mode (auto allows everything)', () => {
        expect(canUseTool('auto', 'write_plan')).toBe(true)
      })
    })

    it('keeps the runtime, system prompt, and introspection docs in sync', async () => {
      const [systemPrompt, docs] = await Promise.all([
        readFile(new URL('../src/agent/system-prompt.md', import.meta.url), 'utf8'),
        Introspect.execute({}),
      ])

      for (const [mode, expected] of Object.entries(DOCUMENTED_MODE_TOOLS) as Array<[RestrictedMode, string[]]>) {
        const sorted = [...expected].sort()
        expect(getToolsForMode(mode).sort()).toEqual(sorted)
        expect(documentedTools(docs, mode).sort()).toEqual(sorted)
      }

      const nativeTools = allTools.map((tool) => tool.name).sort()
      expect(nativeTools).toHaveLength(25)
      expect(getToolsForMode('auto').sort()).toEqual(nativeTools)
      expect(nativeTools.every((tool) => canUseTool('auto', tool))).toBe(true)
      expect(nativeTools.filter((tool) => !Object.values(DOCUMENTED_MODE_TOOLS).flat().includes(tool))).toEqual(['create_goal'])
      expect(systemPrompt).toContain('<deepseek-runtime-contract>')
      expect(systemPrompt).toContain('The tool schemas sent with the request are the only source of truth')
      for (const mode of ['review', 'plan', 'build', 'auto']) expect(systemPrompt).toContain(`- ${mode}:`)
      // The core is deliberately compact: concrete operating rules, no tool catalog or CLI manual.
      expect(systemPrompt.split('\n').length).toBeGreaterThanOrEqual(40)
      expect(systemPrompt.split('\n').length).toBeLessThanOrEqual(160)
      expect(systemPrompt).not.toContain('## 17. Tool: write_file')
      expect(systemPrompt).not.toContain('## 45. CLI command reference')
      expect(docs).toContain('| Auto | All 25 native tools and dynamically discovered MCP tools |')
    })
  })

  describe('canModelActivateMode()', () => {
    it('should return true for build (model can freely switch)', () => {
      expect(canModelActivateMode('build')).toBe(true)
    })

    it('should return true for plan (model can freely switch)', () => {
      expect(canModelActivateMode('plan')).toBe(true)
    })

    it('should return false for auto (only user can activate)', () => {
      expect(canModelActivateMode('auto')).toBe(false)
    })
  })

  describe('isDestructiveShell()', () => {
    it('should detect rm -rf', () => {
      expect(isDestructiveShell('rm -rf /tmp/foo')).toBe(true)
    })

    it('should detect rm -r', () => {
      expect(isDestructiveShell('rm -r ./dir')).toBe(true)
    })

    it('should detect git reset --hard', () => {
      expect(isDestructiveShell('git reset --hard HEAD~1')).toBe(true)
    })

    it('should detect git clean', () => {
      expect(isDestructiveShell('git clean -fd')).toBe(true)
    })

    it('should detect git push --force', () => {
      expect(isDestructiveShell('git push --force origin main')).toBe(true)
    })

    it('should detect git push -f', () => {
      expect(isDestructiveShell('git push -f origin main')).toBe(true)
    })

    it('should detect git checkout -- .', () => {
      expect(isDestructiveShell('git checkout -- .')).toBe(true)
    })

    it('should detect git restore .', () => {
      expect(isDestructiveShell('git restore .')).toBe(true)
    })

    it('should detect chmod -R', () => {
      expect(isDestructiveShell('chmod -R 777 /tmp')).toBe(true)
    })

    it('should detect dd', () => {
      expect(isDestructiveShell('dd if=/dev/zero of=/dev/sda')).toBe(true)
    })

    it('should detect mkfs', () => {
      expect(isDestructiveShell('mkfs.ext4 /dev/sda1')).toBe(true)
    })

    it('should NOT flag safe commands', () => {
      expect(isDestructiveShell('ls -la')).toBe(false)
      expect(isDestructiveShell('git status')).toBe(false)
      expect(isDestructiveShell('cat file.txt')).toBe(false)
      expect(isDestructiveShell('npm install')).toBe(false)
      expect(isDestructiveShell('git push origin main')).toBe(false)
    })
  })

  describe('isConfigWrite()', () => {
    it('should return true for write_file to .deepseek path', () => {
      expect(isConfigWrite('write_file', { path: '/home/user/project/.deepseek/settings.json' })).toBe(true)
    })

    it('should return true for patch_file to .deepseek path', () => {
      expect(isConfigWrite('patch_file', { path: '/home/user/.deepseek/agents/foo.json' })).toBe(true)
    })

    it('should return true for edit_file to .deepseek path', () => {
      expect(isConfigWrite('edit_file', { path: '/home/user/.deepseek/agents/foo.json' })).toBe(true)
    })

    it('should return false for write_file to normal path', () => {
      expect(isConfigWrite('write_file', { path: '/home/user/project/src/index.ts' })).toBe(false)
    })

    it('should return false for non-write tools', () => {
      expect(isConfigWrite('read_file', { path: '/home/user/.deepseek/config.json' })).toBe(false)
      expect(isConfigWrite('shell', { command: 'echo hi' })).toBe(false)
    })

    it('should handle file_path arg variant', () => {
      expect(isConfigWrite('write_file', { file_path: '/home/user/.deepseek/config.json' })).toBe(true)
    })
  })
})
