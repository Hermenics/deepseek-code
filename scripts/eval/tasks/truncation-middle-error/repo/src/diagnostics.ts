export function diagnoseBuild(log: string): string {
  const preview = log.slice(0, 400) + '\n...[truncated]...\n' + log.slice(-400)
  const errors = preview.split('\n').filter(line => /error|failed/i.test(line))
  return errors.at(-1) ?? 'No build error found'
}
