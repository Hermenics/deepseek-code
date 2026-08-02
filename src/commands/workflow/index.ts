import type { Command } from '../types.js'

const CONTROLS = new Set(['pause', 'resume', 'stop', 'restart'])

const command: Command = {
  name: 'workflow', aliases: [], description: 'Run or control a Dynamic Workflow',
  parse(args) {
    const [action, target, ...rest] = args
    if (action === 'run' && target) return { type: 'workflow', action: 'run', name: target, args: rest.join(' ') || undefined }
    if (action === 'save' && target && rest[0]) return { type: 'workflow', action: 'save', id: target, name: rest[0] }
    if (action && CONTROLS.has(action) && target) return { type: 'workflow', action: action as 'pause' | 'resume' | 'stop' | 'restart', id: target }
    return { type: 'unknown', input: 'Usage: /workflow run <name> [args-json] | pause|resume|stop|restart <run-id> | save <run-id> <name>' }
  },
}

export default command
