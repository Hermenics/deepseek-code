import type { Command } from '../types.js'
import { FEATURES, loadFeatures, saveFeatures } from '../../features.js'
import type { FeatureName } from '../../features.js'

const FLAG_NAMES = Object.keys(FEATURES) as FeatureName[]

const command: Command = {
  name: 'features',
  aliases: ['experimental'],
  description: 'Toggle experimental feature flags',
  parse(args: string[]) {
    const [flagArg, valueArg] = args

    if (!flagArg) {
      return { type: 'features', action: 'list' }
    }

    const flag = FLAG_NAMES.find(f => f.toLowerCase() === flagArg.toLowerCase())
    if (!flag) {
      return { type: 'features', action: 'error', message: `Unknown flag: ${flagArg}. Available: ${FLAG_NAMES.join(', ')}` }
    }

    if (!valueArg) {
      return { type: 'features', action: 'toggle', flag }
    }

    if (valueArg === 'on' || valueArg === 'true' || valueArg === '1') {
      return { type: 'features', action: 'set', flag, value: true }
    }

    if (valueArg === 'off' || valueArg === 'false' || valueArg === '0') {
      return { type: 'features', action: 'set', flag, value: false }
    }

    return { type: 'features', action: 'error', message: `Invalid value: ${valueArg}. Use on/off` }
  },
}

export default command
export { loadFeatures, saveFeatures, isEnabled } from '../../features.js'
export type { FeatureName } from '../../features.js'
