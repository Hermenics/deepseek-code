import type { Command } from '../types.js'

const ACTIONS = ['status', 'show', 'hide', 'close'] as const

/** `/browser [status|show|hide|close]`: inspect the agent's browser, open it in a window you can watch and take over, hide it, or close it. */
const command: Command = {
  name: 'browser',
  aliases: [],
  description: 'Show, hide or close the agent browser',
  parse(args: string[]) {
    const action = (args[0] ?? 'status').toLowerCase()
    if (!(ACTIONS as readonly string[]).includes(action)) return { type: 'browser', action: 'error', message: `Unknown action: ${action}. Use ${ACTIONS.join(', ')}.` }
    return { type: 'browser', action: action as typeof ACTIONS[number] }
  },
}

export default command

/** Text of `/browser status`: whether it runs, how, this session's tabs and approved origins. */
export function formatBrowserStatus(status: { running: boolean; visible: boolean; pid?: number; contexts: Array<{ key: string; active: number; approved: string[]; tabs: Array<{ url: string; title: string }> }> }, key: string, enabled: boolean): string {
  if (!enabled) return 'Browser: off. Turn it on with /features browser on (it asks before visiting each new site).'
  const lines = [status.running ? `Browser: running ${status.visible ? 'in a visible window' : 'headless'} (pid ${status.pid})` : 'Browser: not running (it starts when the agent needs it)']
  const context = status.contexts.find(item => item.key === key)
  if (context?.tabs.length) {
    lines.push('Tabs:', ...context.tabs.map((tab, index) => `  ${index === context.active ? '*' : ' '} ${index} ${tab.url}${tab.title ? ` — "${tab.title}"` : ''}`))
  }
  lines.push(`Approved sites: ${context?.approved.length ? context.approved.join(', ') : 'none yet'}`)
  const others = status.contexts.filter(item => item.key !== key).length
  if (others) lines.push(`${others} other agent context${others === 1 ? '' : 's'} open`)
  lines.push('Use /browser show to watch or take over, /browser hide, /browser close.')
  return lines.join('\n')
}
