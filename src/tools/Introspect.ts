import { Tool } from './types.js'
import * as os from 'os'
import { execaCommand } from 'execa'

export const Introspect: Tool = {
  name: 'introspect',
  description: 'Get system info: OS, cwd, available tools, git status, date/time.',
  parameters: { type: 'object', properties: {} },
  async execute() {
    const lines = [
      `OS: ${os.platform()} ${os.arch()} ${os.release()}`,
      `CWD: ${process.cwd()}`,
      `User: ${os.userInfo().username}`,
      `Date: ${new Date().toISOString()}`,
      `Node: ${process.version}`,
    ]
    for (const cmd of ['bun --version', 'git --version']) {
      try {
        const { stdout } = await execaCommand(cmd, { shell: true, timeout: 3000 })
        lines.push(`${cmd.split(' ')[0]}: ${stdout.trim()}`)
      } catch { /* not available */ }
    }
    try {
      const { stdout } = await execaCommand('git status --short', { shell: true, timeout: 3000 })
      lines.push(`Git status:\n${stdout.trim() || '(clean)'}`)
    } catch { /* not a git repo */ }
    return lines.join('\n')
  },
}
