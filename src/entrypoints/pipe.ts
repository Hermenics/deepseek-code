/**
 * Pipe mode: reads from stdin, runs the agent headlessly, writes to stdout.
 * Usage: echo "refatora isso" | deepseek
 *        cat file.ts | deepseek "explica esse código"
 */
import { Agent } from '../agent/agent.js'
import { loadSavedConfig } from '../ui/setup/ApiKeySetup.js'
import { migrateConfigIfNeeded } from '../utils/credentials.js'
import { setShellConfirmHandler } from '../tools/Shell/Shell.js'

export interface PipeOptions {
  json: boolean
  promptArgs: string[]
}

export function parsePipeArgs(argv = process.argv.slice(2)): PipeOptions {
  return {
    json: argv.includes('--json'),
    promptArgs: argv.filter((arg) => arg !== '--pipe' && arg !== '--json'),
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf-8').trim()
}

async function writeAndDrain(stream: typeof process.stdout | typeof process.stderr, text: string): Promise<void> {
  if (stream.write(text)) return
  await new Promise<void>((resolve) => stream.once('drain', resolve))
}

export default async function runPipe() {
  const options = parsePipeArgs()

  // Pipe mode: deny destructive commands — user cannot interactively confirm
  setShellConfirmHandler(async () => false)

  // Migrate legacy config.json → .env + config.json split
  await migrateConfigIfNeeded()

  // Load saved provider config (respects user's configured provider)
  const { providerConfig, language, enchant } = await loadSavedConfig()

  if (!providerConfig) {
    const apiKey = process.env.DEEPSEEK_API_KEY
    if (!apiKey) {
      const message = 'DEEPSEEK_API_KEY not set and no saved config found'
      if (options.json) {
        await writeAndDrain(process.stdout, JSON.stringify({ ok: false, error: message }) + '\n')
      } else {
        await writeAndDrain(process.stderr, `Error: ${message}\n`)
      }
      process.exitCode = 1
      return
    }
  }

  // Build user message: argv args (excluding --pipe flag) as prompt, stdin as context
  const argPrompt = options.promptArgs.join(' ')
  const stdinContent = await readStdin()

  let userMessage: string
  if (argPrompt && stdinContent) {
    userMessage = `${argPrompt}\n\n\`\`\`\n${stdinContent}\n\`\`\``
  } else if (stdinContent) {
    userMessage = stdinContent
  } else if (argPrompt) {
    userMessage = argPrompt
  } else {
    const message = 'Usage: echo "task" | deepseek --pipe OR deepseek --pipe "task"'
    if (options.json) {
      await writeAndDrain(process.stdout, JSON.stringify({ ok: false, error: message }) + '\n')
    } else {
      await writeAndDrain(process.stderr, `${message}\n`)
    }
    process.exitCode = 1
    return
  }

  const agent = new Agent(providerConfig ?? { provider: 'deepseek' })

  // Wait for async initialization (MCP tools, steering, DEEPSEEK.md) before running
  await agent.readyPromise.catch(() => {})

  // Apply language preference if configured
  if (language) agent.setLanguage(language)

  // Apply enchantment preference if configured
  if (!enchant) agent.setPromptRefinerEnabled(false)

  let output = ''
  const tools: string[] = []

  await new Promise<void>((resolve, reject) => {
    agent.run(userMessage, {
      onToken(token) {
        output += token
        if (!options.json) process.stdout.write(token)
      },
      onToolCall(name) {
        tools.push(name)
        process.stderr.write(`[tool] ${name}\n`)
      },
      onToolResult(_name, _result) {
        // tool results go to agent context, not stdout
      },
      onDone() {
        if (options.json) {
          process.stdout.write(JSON.stringify({ ok: true, output, tools }) + '\n')
        } else if (!output.endsWith('\n')) {
          process.stdout.write('\n')
        }
        resolve()
      },
      onPhaseChange() {},
    }).catch(reject)
  })
}
