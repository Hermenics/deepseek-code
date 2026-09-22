import type { EventEmitter } from 'events'

/** Exit code for a hung-up terminal (128 + SIGHUP), as a shell reports it. */
export const HANGUP_EXIT_CODE = 129

/**
 * Calls `exit` once the controlling terminal is gone: SIGHUP, or the tty stdin
 * reaching EOF / failing with EIO after its pty closed. Without this a TUI keeps
 * rendering into a dead terminal forever (orphaned under init, burning CPU).
 */
export function exitWhenTerminalCloses(
  exit: (code: number) => void,
  stdin: EventEmitter = process.stdin,
  proc: Pick<NodeJS.Process, 'once'> = process,
): void {
  const hangUp = () => exit(HANGUP_EXIT_CODE)
  proc.once('SIGHUP', hangUp)
  stdin.once('end', hangUp)
  stdin.once('error', hangUp)
}
