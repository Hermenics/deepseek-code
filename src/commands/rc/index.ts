import type { Command, CommandResult } from '../types.js'

const command: Command = {
  name: 'remote-control',
  aliases: ['rc'],
  description: 'Control DeepSeek Code from your phone',
  parse(args): CommandResult {
    const action = args[0]
    switch (action) {
      case undefined:
      case 'start':
        return { type: 'remote-control', action: 'start' }
      case 'stop':
        return { type: 'remote-control', action: 'stop' }
      case 'status':
        return { type: 'remote-control', action: 'status' }
      case 'devices':
        return { type: 'remote-control', action: 'devices' }
      case 'unpair':
        return { type: 'remote-control', action: 'unpair', deviceId: args[1] }
      default:
        return { type: 'unknown', input: `Unknown /rc subcommand: ${action}. Use start, stop, status, devices, unpair.` }
    }
  },
}

export default command
