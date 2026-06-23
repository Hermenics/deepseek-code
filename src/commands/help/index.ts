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
  /agent <name>          load a custom agent
  /agents                list available agents
  /models                switch model (interactive)
  /language              change preferred language
  /theme                 change color theme
  /clear                 clear chat history
  /compact               summarize history to save context
  /undo                  restore last file modified by agent
  /undo all              restore ALL files modified this session
  /undo list             list file checkpoints this session
  /retry                 re-run last message
  /tools                 list all available tools
  /system                show active system prompt
  /cost                  show estimated session cost
  /files                 list files modified this session
  /sessions              list recent sessions (use --resume <id> to restore)
  /checkpoint [save [label]]     save current state
  /checkpoint list               list saved checkpoints
  /checkpoint restore <id>       restore a checkpoint
  /plan <task>           plan implementation of a task
  /review [file]         review project code or a specific file
  /permissions           show current tool permission settings
  /msg <note>            add a note for the agent without interrupting it
  /vim                   toggle vim keybindings (normal/insert mode)
  /stats                 show session statistics
  /memory                show persistent memory contents
  /memory clear [agent|user]  clear memory (both or specific)
  /quit  /q              exit`

export default command
