#!/usr/bin/env bun
export {}
// DeepSeek Code — AI coding assistant CLI
// Select a headless actor before importing any TUI entrypoint side effects.
if (process.argv[2] === '--bot-worker') {
  const { runBotWorker } = await import('./bots/worker.js')
  try {
    if (!process.argv[3] || !process.argv[4]) throw new Error('Bot worker requires a database path and bot ID')
    await runBotWorker(process.argv[3], process.argv[4])
  } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1 }
} else if (process.argv[2] === 'pods') {
  const { runPodsCli } = await import('./bots/cli.js')
  try { await runPodsCli(process.argv.slice(3)) }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1 }
} else if (process.argv[2] === 'bots') {
  console.error('The persistent-agent command is now `deepseek pods`.')
  process.exitCode = 1
} else {
  await import('./entrypoints/cli.js')
}
