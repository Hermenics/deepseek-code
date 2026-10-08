import terminalChalk from 'chalk'

// Compartilha a detecção de cores com a TUI, inclusive em terminais Bun sem isTTY.
if (process.env.NO_COLOR !== undefined || process.env.FORCE_COLOR === '0' || process.env.FORCE_COLOR === 'false' || process.env.TERM === 'dumb') terminalChalk.level = 0
else if (terminalChalk.level === 0) {
  const colorterm = process.env.COLORTERM
  const term = process.env.TERM ?? ''
  if (colorterm === 'truecolor' || colorterm === '24bit') terminalChalk.level = 3
  else if (colorterm === 'ansi256' || term.includes('256color')) terminalChalk.level = 2
  else if (process.stdout.isTTY || term !== '') terminalChalk.level = 1
}

export const cliStyle = terminalChalk
