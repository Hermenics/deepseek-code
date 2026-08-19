/** Build a shell command that runs the current Bun executable on every OS. */
export function runScript(script: string): string {
  const executable = process.execPath.includes(' ') ? `"${process.execPath}"` : process.execPath
  return `${executable} -e "${script.replaceAll('"', '\\"')}"`
}

export function printOutput(output: string): string {
  return runScript(`process.stdout.write(Buffer.from('${Buffer.from(output).toString('base64')}', 'base64'))`)
}

export function printLines(expression: string): string {
  return runScript(`process.stdout.write(${expression})`)
}
