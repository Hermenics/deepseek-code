import type { Command } from '../types.js'

/** `/mobile` (aliases `/ios`, `/android`): shows a QR code for downloading the DeepSeek mobile app. */
const command: Command = {
  name: 'mobile',
  aliases: ['ios', 'android'],
  description: 'Show QR code to download the DeepSeek mobile app',
  parse() {
    return { type: 'mobile' }
  },
}

export default command
