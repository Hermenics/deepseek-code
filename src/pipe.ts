/**
 * Pipe mode: reads from stdin, runs the agent headlessly, writes to stdout.
 * Usage: echo "refatora isso" | deepseek
 *        cat file.ts | deepseek "explica esse código"
 */
import { Agent } from './agent/agent.js'
import { loadSavedConfig } from './ui/setup/ApiKeySetup.js'
import { setShellConfirmHandler } from './tools/Shell.js'

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf-8').trim()
}

export default async function runPipe() {
  // Auto-confirm destructive commands in pipe mode (non-interactive)
  setShellConfirmHandler(async () => true)

  // Load saved provider config (respects user's configured provider)
  const { providerConfig } = await loadSavedConfig()

  if (!providerConfig) {
    const apiKey = process.env.DEEPSEEK_API_KEY
    if (!apiKey) {
      process.stderr.write('Error: DEEPSEEK_API_KEY not set and no saved config found\n')
      process.exit(1)
    }
  }

  // Build user message: argv args (excluding --pipe flag) as prompt, stdin as context
  const argPrompt = process.argv.slice(2).filter((a) => a !== '--pipe').join(' ')
  const stdinContent = await readStdin()

  let userMessage: string
  if (argPrompt && stdinContent) {
    userMessage = `${argPrompt}\n\n\`\`\`\n${stdinContent}\n\`\`\``
  } else if (stdinContent) {
    userMessage = stdinContent
  } else if (argPrompt) {
    userMessage = argPrompt
  } else {
    process.stderr.write('Usage: echo "task" | deepseek  OR  deepseek "task"\n')
    process.exit(1)
  }

  const agent = new Agent(providerConfig ?? { provider: 'deepseek' })

  let output = ''

  await new Promise<void>((resolve, reject) => {
    agent.run(userMessage, {
      onToken(token) {
        output += token
        process.stdout.write(token)
      },
      onToolCall(name) {
        process.stderr.write(`[tool] ${name}\n`)
      },
      onToolResult(_name, _result) {
        // tool results go to agent context, not stdout
      },
      onDone() {
        if (!output.endsWith('\n')) process.stdout.write('\n')
        resolve()
      },
      onPhaseChange() {},
    }).catch(reject)
  })
}
