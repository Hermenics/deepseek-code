export function getCurrentInvocation(
  args: readonly string[] = process.argv.slice(2),
  entrypoint = process.argv[1],
  runtime = process.execPath,
): string[] {
  if (!entrypoint) throw new Error('Cannot relaunch DeepSeek Code without an entrypoint')
  return [runtime, entrypoint, ...args]
}

/**
 * Start the exact command that launched the current process with the updated
 * package, keeping the terminal, cwd, environment, and user arguments intact.
 * The parent waits only long enough to hand control to the replacement process.
 */
export async function relaunchCurrentInvocation(args: readonly string[] = process.argv.slice(2)): Promise<number> {
  const child = Bun.spawn(getCurrentInvocation(args), {
    cwd: process.cwd(),
    env: process.env,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  })
  return await child.exited
}
