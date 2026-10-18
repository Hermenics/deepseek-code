import { readShellSupervisorRequest, runShellSupervisor } from './supervisor.js'

if (import.meta.main) {
  try {
    const request = await readShellSupervisorRequest(process.stdin)
    await runShellSupervisor(request)
    process.exit(0)
  } catch (error) {
    process.stderr.write(`Shell supervisor failed: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  }
}
