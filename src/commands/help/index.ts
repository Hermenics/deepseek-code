import type { Command } from '../types.js'

const command: Command = {
  name: 'help',
  aliases: [],
  description: 'Show available commands',
  parse() {
    return { type: 'help' }
  },
}

export const HELP_TEXT = `Commands:
  /help                  show this help
  /model [name]          choose a model
  /config (or /settings) open settings
  /features [flag] [on|off]  manage experimental features
  /clear                  clear this chat
  /compact                summarize history
  /plan <task>           plan a task
  /review [file]         review the project or file
  /agent <name>          load a custom agent
  /agents                list custom agents
  /vim                   toggle Vim input mode
  /checkpoint [save [label]|list|restore <id>]
  /sessions              list recent sessions
  /undo [all|list]       restore agent file changes
  /retry                 rerun the last message
  /cost                  show estimated cost
  /files                 list session file changes
  /tools                 list available tools
  /system                show the system prompt
  /permissions           show tool permissions
  /btw <question>        ask a side question
  /stats                 show session statistics
  /memory (or /mem) [clear [agent|user]]
  /effort [low|high|max|auto]
  /skill (or /skills)    manage skills
  /plugin (or /plugins)  manage plugins
  /context (or /ctx)     show context usage
  /tasks                 show session tasks
  /task <id> <action>    inspect or control a task
  /cwd (or /cd) [path]   show or change directory
  /worktree (or /wt) [create|enter|exit|list|status]
  /mobile                show the mobile-app QR code
  /logout                clear stored credentials
  /quit (or /q)          exit`

export default command
