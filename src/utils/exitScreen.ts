export const EXIT_LOGO = `██████╗ ███████╗███████╗██████╗ ███████╗███████╗███████╗██╗  ██╗
██╔══██╗██╔════╝██╔════╝██╔══██╗██╔════╝██╔════╝██╔════╝██║ ██╔╝
██║  ██║█████╗  █████╗  ██████╔╝███████╗█████╗  █████╗  █████╔╝
██║  ██║██╔══╝  ██╔══╝  ██╔═══╝ ╚════██║██╔══╝  ██╔══╝  ██╔═██╗
██████╔╝███████╗███████╗██║     ███████║███████╗███████╗██║  ██╗
╚═════╝ ╚══════╝╚══════╝╚═╝     ╚══════╝╚══════╝╚══════╝╚═╝  ╚═╝

 ██████╗ ██████╗ ██████╗ ███████╗
██╔════╝██╔═══██╗██╔══██╗██╔════╝
██║     ██║   ██║██║  ██║█████╗
██║     ██║   ██║██║  ██║██╔══╝
╚██████╗╚██████╔╝██████╔╝███████╗
 ╚═════╝ ╚═════╝ ╚═════╝ ╚══════╝`

/** Builds the text printed on exit; shows a resume command only for a saved session. */
export function formatExitScreen(sessionId: string | null, alternateScreen: boolean): string {
  const leaveAlternateScreen = alternateScreen ? '\x1b[?1049l' : ''
  return [
    `\x1b[?1000l\x1b[?1002l\x1b[?1003l${leaveAlternateScreen}`,
    '\x1b[2J\x1b[3J\x1b[H\x1b[?25h',
    `\x1b[34m${EXIT_LOGO}\x1b[0m`,
    ...(sessionId ? ['', '  To continue this session, run:', `  deepseek --resume ${sessionId}`] : []),
    '',
  ].join('\n') + '\n'
}
