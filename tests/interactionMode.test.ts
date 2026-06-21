import { describe, it, expect } from 'bun:test'
import {
  nextMode,
  isBuildMode,
  isAutoMode,
  canUseTool,
  canModelActivateMode,
  isDestructiveShell,
  isConfigWrite,
  DEFAULT_MODE,
  MODES,
  type InteractionMode,
} from '../src/ui/interactionMode.js'

describe('interactionMode', () => {
  describe('MODES', () => {
    it('should define exactly three modes: plan, build, and auto', () => {
      expect(MODES).toEqual(['plan', 'build', 'auto'])
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

    it('should return build when current mode is plan', () => {
      expect(nextMode('plan')).toBe('build')
    })

    it('should cycle plan → build → auto → plan', () => {
      let mode: InteractionMode = 'plan'
      mode = nextMode(mode) // build
      expect(mode).toBe('build')
      mode = nextMode(mode) // auto
      expect(mode).toBe('auto')
      mode = nextMode(mode) // plan
      expect(mode).toBe('plan')
    })

    it('should return plan after 3 consecutive calls starting from plan (1 complete cycle)', () => {
      let mode: InteractionMode = 'plan'
      for (let i = 0; i < 3; i++) {
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

      it('should allow subagent', () => {
        expect(canUseTool('plan', 'subagent')).toBe(true)
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
