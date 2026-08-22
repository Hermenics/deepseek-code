// Slash-command actions for the Web GUI. Kept out of bridge.ts so the transport
// layer stays readable while this file mirrors the TUI command surface 1:1.
import type { CommandResult } from '../commands/index.js'
import type { WebAgent } from './bridge.js'

export interface WebCommandContext {
  agent: WebAgent
  sessionId: string
  /** Emit an assistant-style result into the browser transcript. */
  respond(content: string, clear?: boolean): void
  /** Ask the browser for a yes/no decision (renders the confirm modal). */
  confirm(message: string): Promise<boolean>
  /** Run a prompt through the agent, streaming tokens as usual. */
  run(prompt: string): Promise<void>
  /** Re-read git state after a command moved the workspace. */
  workspaceChanged(): void
}

const cwdOf = (context: WebCommandContext): string => context.agent.getWorkingDirectory?.() ?? process.cwd()

async function runSessions(command: Extract<CommandResult, { type: 'sessions' }>, context: WebCommandContext): Promise<void> {
  const { exportSession, listSessions } = await import('../agent/session.js')
  if ('action' in command && command.action === 'export') {
    context.respond(`Sanitized session export written to ${await exportSession(command.id, command.format, cwdOf(context))}`)
    return
  }
  const sessions = await listSessions()
  if (!sessions.length) { context.respond('No saved sessions.'); return }
  const lines = sessions.slice(0, 10).map((session) => {
    const title = session.title ?? session.uiMessages.find((message) => message.role === 'user')?.content?.split('\n')[0] ?? 'New conversation'
    const messages = session.uiMessages.filter((message) => message.role === 'user').length
    return `  ${session.id}  ${title}  ${new Date(session.updatedAt).toLocaleString()}  ${messages} messages  ${session.cwd}`
  })
  context.respond(`Recent sessions:\n${lines.join('\n')}\n\nResume: deepseek --resume <id>\nExport: /sessions export <id> [json|md]`)
}

async function runMemory(command: Extract<CommandResult, { type: 'memory' }>, context: WebCommandContext): Promise<void> {
  const memory = context.agent.orchestrator?.memory
  if (!memory) { context.respond('Memory is unavailable.'); return }
  await context.agent.readyPromise?.catch(() => {})
  if (command.action === 'clear') {
    await memory.clear(command.target)
    context.respond(`Memory cleared${command.target ? ` (${command.target})` : ''}.`)
    return
  }
  const [agentEntries, userEntries] = await Promise.all([memory.load('agent'), memory.load('user')])
  const section = (title: string, entries: string[]) => [
    `**${title}** (${entries.length} entries)`,
    ...(entries.length ? entries.map((entry, index) => `  ${index + 1}. ${entry}`) : ['  (empty)']),
  ]
  context.respond([...section('Agent Memory', agentEntries), '', ...section('User Preferences', userEntries)].join('\n'))
}

async function runGoal(command: Extract<CommandResult, { type: 'goal' }>, context: WebCommandContext): Promise<void> {
  const { GOAL_MAX_CONTINUATIONS, buildContinuationPrompt, createGoal, getGoal, resumeGoal, setGoal, updateGoal } = await import('../agent/goal.js')
  const goal = getGoal()
  const stamp = () => new Date().toISOString()

  if (command.action === 'set') {
    const unfinished = new Set(['active', 'paused', 'blocked', 'budget_limited', 'usage_limited'])
    if (goal && unfinished.has(goal.status)) {
      context.respond(`An unfinished goal already exists: "${goal.objective}" (${goal.status}). Complete or clear it first with /goal clear.`)
      return
    }
    createGoal(command.objective, undefined, command.maxContinuations ?? context.agent.settings?.goal?.maxContinuations)
    await context.run(`Execute the following goal: "${command.objective}". When the goal is achieved, call update_goal with status "complete". If you are stuck on the same blocker for 3 consecutive turns, call update_goal with status "blocked" and describe the blocker.`)
    return
  }
  if (!goal) {
    const missing = { show: 'No goal is currently set. Usage: /goal <objective>', edit: 'No goal to edit. Use /goal <objective> to set one.', pause: 'No active goal to pause.', resume: 'No goal to resume.', clear: 'No goal to clear.' }
    context.respond(missing[command.action])
    return
  }
  const maxTurns = goal.maxContinuations ?? GOAL_MAX_CONTINUATIONS
  switch (command.action) {
    case 'show': {
      const status = goal.status === 'blocked' && goal.blockReason ? `blocked (${goal.blockReason})` : goal.status
      context.respond([
        `Goal: ${goal.objective}`, `Status: ${status}`,
        `Tokens: ${goal.tokensUsed}${goal.tokenBudget !== undefined ? `\nToken budget: ${goal.tokenBudget}` : ''}`,
        `Turns: ${goal.continuations}/${maxTurns}`, '', 'Commands: /goal edit, /goal pause, /goal resume, /goal clear',
      ].join('\n'))
      return
    }
    case 'edit': context.respond(`Current goal: "${goal.objective}"\nTo edit, use /goal <new objective> to replace it.`); return
    case 'pause': updateGoal({ status: 'paused', updatedAt: stamp() }); context.respond(`Goal paused: "${goal.objective}"`); return
    case 'clear': setGoal(null); context.respond('Goal cleared.'); return
    case 'resume': {
      if (goal.status === 'complete') { context.respond('Goal is already complete. Use /goal <new objective> to set a new one.'); return }
      if (goal.status === 'budget_limited' || goal.status === 'usage_limited') { context.respond(`Goal is ${goal.status}. Use /goal <new objective> to set a new goal.`); return }
      // Resuming must honour the same ceilings the automatic continuation loop enforces.
      if (goal.continuations >= maxTurns) {
        updateGoal({ status: 'budget_limited', updatedAt: stamp() })
        context.respond(`⚠ Goal turn limit reached (${goal.continuations}/${maxTurns} turns). Goal paused.`)
        return
      }
      if (goal.tokenBudget !== undefined && goal.tokensUsed >= goal.tokenBudget) {
        updateGoal({ status: 'budget_limited', updatedAt: stamp() })
        context.respond(`⚠ Goal budget limit reached (${goal.tokensUsed}/${goal.tokenBudget} tokens). Goal paused.`)
        return
      }
      const resumed = resumeGoal()
      updateGoal({ continuations: resumed.continuations + 1, updatedAt: stamp() })
      const nextTurn = resumed.continuations + 1
      context.respond(`Goal resumed: "${resumed.objective}" (turn ${nextTurn}/${maxTurns})\n\nResuming...`)
      await context.run(buildContinuationPrompt(getGoal() ?? resumed, nextTurn))
    }
  }
}

async function runWorktree(command: Extract<CommandResult, { type: 'worktree' }>, context: WebCommandContext): Promise<void> {
  const { createWorktree, enterWorktree, exitWorktree, getActiveWorktree, listWorktrees } = await import('../agent/worktree.js')
  const projectRoot = cwdOf(context)
  // create/enter/exit all relocate the workspace. Refuse before the side effect
  // so an unusable worktree is never created just to fail on the move.
  if (!context.agent.setWorkingDirectory && command.action !== 'list' && command.action !== 'status') {
    context.respond('Changing the working directory is unavailable in this session.')
    return
  }
  const move = async (path: string, message: string) => {
    await context.agent.setWorkingDirectory?.(path)
    context.workspaceChanged()
    context.respond(message)
  }
  switch (command.action) {
    case 'create': {
      const info = await createWorktree(projectRoot, context.sessionId)
      await move(info.path, `Worktree "${info.name}" created at ${info.path}\nTool workspace changed to the worktree.`)
      return
    }
    case 'enter': {
      const info = await enterWorktree(projectRoot, command.name, context.sessionId)
      await move(info.path, `Entered worktree "${info.name}" at ${info.path}`)
      return
    }
    case 'exit': {
      const result = await exitWorktree(projectRoot, command.keep)
      await move(projectRoot, result)
      return
    }
    case 'list': {
      const worktrees = await listWorktrees(projectRoot)
      context.respond(worktrees.length ? `Worktrees:\n${worktrees.map((tree) => `  ${tree.name}  ${tree.path}  (${tree.isGitWorktree ? 'git' : 'copy'})`).join('\n')}` : 'No worktrees found.')
      return
    }
    case 'status': {
      const active = await getActiveWorktree(projectRoot)
      context.respond(active ? `Active worktree: "${active.name}"\nPath: ${active.path}\nCreated: ${active.createdAt}` : 'No active worktree.')
    }
  }
}

async function runSkill(command: Extract<CommandResult, { type: 'skill' }>, context: WebCommandContext): Promise<void> {
  if (command.action === 'help') { context.respond('Skill commands:\n  /skill install <owner/repo>  install a skill from GitHub\n  /skill list                  list installed skills\n  /skill remove <name>         remove an installed skill\n  /skill update <name>         update a skill to latest'); return }
  if (command.action === 'error') { context.respond(`Error: ${command.message}`); return }
  const { installSkill, listSkills, removeSkill, updateSkill } = await import('../skills/installer.js')
  const { join } = await import('node:path')
  const cwd = cwdOf(context)
  const primary = join(cwd, '.deepseek', 'skills')
  const legacy = join(cwd, '.claude', 'skills')
  if (command.action === 'list') {
    const [primarySkills, legacySkills] = await Promise.all([listSkills(primary).catch(() => []), listSkills(legacy).catch(() => [])])
    const merged = [...primarySkills, ...legacySkills.filter((skill) => !primarySkills.some((item) => item.name === skill.name))]
    if (!merged.length) { context.respond('No skills installed via /skill. Use /skill install <owner/repo> to add one.'); return }
    context.respond(`Installed skills:\n${merged.map((skill) => `  ${skill.name}  (${skill.repo})  ${skill.description}`).join('\n')}`)
    return
  }
  if (command.action === 'install') {
    const result = await installSkill(command.repo, primary)
    context.respond(result.ok ? `✓ Skill '${result.name}' installed successfully.` : `✗ ${result.error}`)
    return
  }
  if (command.action === 'remove') {
    let result = await removeSkill(command.name, primary)
    if (!result.ok) result = await removeSkill(command.name, legacy)
    context.respond(result.ok ? `✓ Skill '${result.name}' removed.` : `✗ Skill '${command.name}' not found in .deepseek/skills or .claude/skills.`)
    return
  }
  let result = await updateSkill(command.name, primary)
  if (!result.ok) result = await updateSkill(command.name, legacy)
  context.respond(result.ok ? `✓ Skill '${result.name}' updated.` : `✗ ${result.error}`)
}

async function runPlugin(command: Extract<CommandResult, { type: 'plugin' }>, context: WebCommandContext): Promise<void> {
  if (command.action === 'help') { context.respond('Plugin commands:\n  /plugin install <owner/repo>  install a plugin from GitHub\n  /plugin list                  list installed plugins\n  /plugin remove <name>         remove a plugin\n  /plugin update <name>         update a plugin to latest'); return }
  if (command.action === 'error') { context.respond(`Error: ${command.message}`); return }
  const { installPlugin, loadInstalledPlugins, removePlugin, updatePlugin } = await import('../plugins/index.js')
  if (command.action === 'list') {
    const plugins = loadInstalledPlugins()
    if (!plugins.length) { context.respond('No plugins installed. Use /plugin install <owner/repo> to add one.'); return }
    context.respond(`Installed plugins:\n${plugins.map((plugin) => {
      const parts = plugin.entry.components
      const summary = [
        ...(parts.commands.length ? [`${parts.commands.length} cmd`] : []),
        ...(parts.agents.length ? [`${parts.agents.length} agents`] : []),
        ...(parts.skills.length ? [`${parts.skills.length} skills`] : []),
        ...(parts.hasHooks ? ['hooks'] : []),
      ]
      return `  ${plugin.entry.name}  (${plugin.entry.repo})  [${summary.join(', ')}]`
    }).join('\n')}`)
    return
  }
  const result = command.action === 'install' ? await installPlugin(command.repo)
    : command.action === 'remove' ? await removePlugin(command.name)
      : await updatePlugin(command.name)
  const verb = command.action === 'install' ? 'installed successfully' : command.action === 'remove' ? 'removed' : 'updated'
  context.respond(result.ok ? `✓ Plugin '${result.name}' ${verb}.` : `✗ ${result.error}`)
}

async function runCwd(command: Extract<CommandResult, { type: 'cwd' }>, context: WebCommandContext): Promise<void> {
  if (!command.path) { context.respond(`cwd: ${cwdOf(context)}`); return }
  if (!context.agent.setWorkingDirectory) { context.respond('Changing the working directory is unavailable in this session.'); return }
  const { resolve } = await import('node:path')
  const { statSync } = await import('node:fs')
  const target = resolve(command.path.replace(/^~/, process.env.HOME ?? ''))
  try {
    if (!statSync(target).isDirectory()) { context.respond(`✗ Not a directory: ${target}`); return }
  } catch { context.respond(`✗ Cannot access: ${target}`); return }
  await context.agent.setWorkingDirectory?.(target, true)
  context.workspaceChanged()
  context.respond(`cwd: ${target}`)
}

async function runFeatures(command: Extract<CommandResult, { type: 'features' }>, context: WebCommandContext): Promise<void> {
  if (command.action === 'error') { context.respond(`Error: ${command.message}`); return }
  const { FEATURES, loadFeatures, saveFeatures } = await import('../features.js')
  type FeatureName = keyof typeof FEATURES
  const flags = loadFeatures()
  if (command.action === 'list') {
    const lines = (Object.keys(FEATURES) as FeatureName[]).map((flag) => `  ${flags[flag] ? '✓' : '○'} ${flag} — ${FEATURES[flag].description}`)
    context.respond(`Experimental features:\n${lines.join('\n')}\n\nUse /features <flag> on|off.`)
    return
  }
  const flag = command.flag as FeatureName
  const value = command.action === 'toggle' ? !flags[flag] : command.value
  saveFeatures({ ...flags, [flag]: value })
  context.respond(`Feature ${flag} ${value ? 'enabled' : 'disabled'}.`)
}

async function runVerify(context: WebCommandContext): Promise<void> {
  const { detectVerificationCommand, runVerification } = await import('../agent/verify.js')
  const cwd = cwdOf(context)
  const command = await detectVerificationCommand(cwd)
  if (!command) { context.respond('No supported project test command found.'); return }
  if (!await context.confirm(`Run verification?\n\n${command.display}`)) return
  const result = await runVerification(command, cwd)
  context.respond(`${result.ok ? '✓' : '✗'} ${command.display}\n\n${result.output}`)
}

/**
 * Runs the Web action for a parsed slash command. Returns false when the command
 * has no meaningful Web equivalent, letting the bridge explain why.
 */
export async function runWebCommand(command: CommandResult, context: WebCommandContext): Promise<boolean> {
  const { agent, respond } = context
  switch (command.type) {
    case 'sessions': await runSessions(command, context); return true
    case 'memory': await runMemory(command, context); return true
    case 'goal': await runGoal(command, context); return true
    case 'worktree': await runWorktree(command, context); return true
    case 'skill': await runSkill(command, context); return true
    case 'plugin': await runPlugin(command, context); return true
    case 'cwd': await runCwd(command, context); return true
    case 'features': await runFeatures(command, context); return true
    case 'verify': await runVerify(context); return true
    case 'tasks': respond(agent.formatTasks?.() ?? 'Task tracking is unavailable.'); return true
    case 'task': respond(await agent.controlTask?.(command.id, command.action, 'message' in command ? command.message : undefined) ?? 'Task control is unavailable.'); return true
    case 'context': {
      const breakdown = agent.getContextBreakdown?.()
      if (!breakdown) { respond('Context breakdown is unavailable.'); return true }
      const { formatContextBreakdown } = await import('../agent/contextBreakdown.js')
      respond(formatContextBreakdown(breakdown))
      return true
    }
    case 'permissions': {
      const info = agent.getPermissionsInfo?.()
      if (!info) { respond('Permission info is unavailable.'); return true }
      const { formatPermissionsReport } = await import('../permissions/index.js')
      respond(formatPermissionsReport(info))
      return true
    }
    case 'doctor': {
      const { formatDoctorReport, runDoctor } = await import('../doctor.js')
      respond(formatDoctorReport(await runDoctor(cwdOf(context))))
      return true
    }
    case 'catalog': {
      const { formatCatalog } = await import('../catalog.js')
      respond(formatCatalog(command.kind))
      return true
    }
    case 'agents': {
      const { listAgents } = await import('../agent/config.js')
      const agents = await listAgents(cwdOf(context))
      respond(agents.length
        ? `Available agents:\n${agents.map((item) => `  ${item.name} (${item.source})`).join('\n')}`
        : 'No agents found. Create .deepseek/agents/<name>.json or ~/.deepseek/agents/<name>.json')
      return true
    }
    case 'agent': {
      const { loadAgentConfig } = await import('../agent/config.js')
      const { config, source } = await loadAgentConfig(command.name, cwdOf(context))
      await agent.applyAgentConfig?.(config)
      respond(`Agent '${config.name}' loaded from ${source === 'local' ? 'local (overrides global)' : 'global'}.`)
      return true
    }
    case 'models': {
      const models = await agent.getAvailableModels?.()
      respond(models?.length ? `Available models:\n${models.map((model) => `  ${model}`).join('\n')}\n\nSwitch with /model <name>.` : 'No models available.')
      return true
    }
    case 'retry': {
      const last = agent.getLastUserMessage?.()
      if (!last) { respond('Nothing to retry.'); return true }
      await context.run(last)
      return true
    }
    case 'logout': {
      const { logout } = await import('../utils/credentials.js')
      await logout()
      respond('Credentials removed. Stop this server and run `deepseek` to configure a provider again.')
      return true
    }
    // User/project commands from .deepseek/commands/*.md expand to a prompt.
    case 'custom': await context.run(command.prompt); return true
    case 'gui': respond('You are already using the DeepSeek Code GUI.'); return true
    case 'mobile': respond('Open this same URL (including its token) on your phone while on the same network.'); return true
    // Terminal-only surfaces: the browser composer has native editing, and the
    // page cannot own the server process lifecycle.
    case 'vim': respond('Vim mode applies to the terminal UI only — the browser composer uses native text editing.'); return true
    case 'quit': respond('Close this browser tab to leave the GUI, or press Ctrl+C in the terminal running `deepseek --web` to stop the server.'); return true
    case 'config': respond('Interactive configuration is terminal-only. Run `deepseek` in a terminal to open the config menu.'); return true
    default: return false
  }
}
