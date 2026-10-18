import { globMatch } from './matcher.js'
import type { RiskRule, RiskContext, RiskAssessment } from './types.js'
import { browserActionKind, browserTarget, isLoopbackOrigin, originOf } from './browser.js'

function shellCommandSubstitution(depth: number): string {
  return depth === 0
    ? String.raw`\$\([^()]*\)`
    : String.raw`\$\((?:[^()]|${shellCommandSubstitution(depth - 1)})*\)`
}

// shortcut: parse command substitutions to three nested levels; use a shell AST before supporting arbitrary shell grammar.
const SHELL_ASSIGNMENT_FRAGMENT = String.raw`(?:'[^']*'|"(?:[^"\\]|\\.)*"|${shellCommandSubstitution(3)}|\\[^\n]|[^\s;&|'" ])`
const SHELL_ASSIGNMENT_WORD = String.raw`[A-Za-z_]\w*=(?:${SHELL_ASSIGNMENT_FRAGMENT})*`
const ENV_OPTION_WITH_VALUE = String.raw`(?:-u|--unset|-C|--chdir|-S|--split-string)`
const ENV_OPTION_ARGUMENT = String.raw`(?:'[^']*'|"(?:[^"\\]|\\.)*"|\S+)`
const SUDO_OPTION_WITH_VALUE = String.raw`(?:-u|--user|-g|--group|-h|--host|-p|--prompt|-C|--close-from|-R|--chroot|-D|--chdir|-r|--role|-t|--type|-T|--command-timeout)`
const SHELL_COMMAND_PREFIX = String.raw`(?:(?:(?:[^\s;&|]*\/)?env(?:\s+${ENV_OPTION_WITH_VALUE}\s+${ENV_OPTION_ARGUMENT}|\s+-\S+)*\s+(?:${SHELL_ASSIGNMENT_WORD}\s+)*)|(?:sudo(?:\s+${SUDO_OPTION_WITH_VALUE}\s+${ENV_OPTION_ARGUMENT}|\s+-\S+)*\s+)|(?:(?:command|exec)\s+)|(?:(?:[^\s;&|]*\/)?time(?:\s+-p)?\s+)|(?:(?:${SHELL_ASSIGNMENT_WORD}\s+)+))*`
const CLI_OPTIONS = String.raw`(?:[ \t]+--?[A-Za-z0-9][^\s;&|]*(?:[ \t]+(?!-)[^\s;&|]+)?)*[ \t]+(?:--[ \t]+)?`
const NPM_PACKAGE_INSTALL_ACTION = String.raw`(?:install|i|ci|clean-install|it|install-test|cit|clean-install-test|add|exec|dlx|update|up|upgrade)`
const PACKAGE_MANAGER_OPERATION = [
  String.raw`(?:[^\s;&|]*\/)?(?:'corepack'|"corepack"|corepack)[ \t]+npm(?:@[^ \t;&|]+)?${CLI_OPTIONS}${NPM_PACKAGE_INSTALL_ACTION}`,
  String.raw`(?:[^\s;&|]*\/)?(?:'corepack'|"corepack"|corepack)[ \t]+(?:pnpm|yarn)(?:@[^ \t;&|]+)?${CLI_OPTIONS}(?:install|i|ci|add|exec|dlx|update|up|upgrade)`,
  String.raw`npm${CLI_OPTIONS}${NPM_PACKAGE_INSTALL_ACTION}`,
  String.raw`(?:pnpm|yarn)${CLI_OPTIONS}(?:install|i|add|dlx|update|up|upgrade)`,
  String.raw`bun${CLI_OPTIONS}(?:install|add|update|up|x)|(?:npx|bunx)\s+\S+`,
  String.raw`pipx?${CLI_OPTIONS}install|python(?:3(?:\.\d+)?)?\s+-m\s+pip${CLI_OPTIONS}install`,
  String.raw`uv${CLI_OPTIONS}(?:add|install|sync|tool\s+install|pip\s+install)|poetry${CLI_OPTIONS}(?:add|install)`,
  String.raw`cargo${CLI_OPTIONS}(?:add|install)|go${CLI_OPTIONS}(?:get|install)|gem${CLI_OPTIONS}install|bundle${CLI_OPTIONS}install`,
  String.raw`composer${CLI_OPTIONS}(?:install|require)|dotnet${CLI_OPTIONS}(?:add\s+package|tool\s+install)`,
  String.raw`apt(?:-get)?${CLI_OPTIONS}(?:install|upgrade)|(?:dnf|yum)${CLI_OPTIONS}(?:install|upgrade)|pacman${CLI_OPTIONS}-S|brew${CLI_OPTIONS}(?:install|upgrade)`,
].join('|')
const PACKAGE_INSTALL_COMMAND = new RegExp(
  String.raw`^\s*${SHELL_COMMAND_PREFIX}(?:[^\s;&|]*\/)?(?:${PACKAGE_MANAGER_OPERATION})\b`,
  'i',
)
const PACKAGE_MANAGER_OPTIONS_WITH_VALUES: Record<string, Set<string>> = {
  npm: new Set(['--prefix', '--workspace', '-w', '--userconfig', '--cache', '--registry', '--tag', '--scope', '--location', '--omit', '--include']),
  pnpm: new Set(['--dir', '-C', '--filter', '-F', '--config', '--registry', '--workspace-root']),
  bun: new Set(['--cwd', '--filter', '--config', '--registry']),
  yarn: new Set(['--cwd', '--cache-folder', '--use-yarnrc', '--registry', '--modules-folder']),
}
const PACKAGE_LIFECYCLE_SCRIPT_COMMAND = new RegExp(
  String.raw`^\s*${SHELL_COMMAND_PREFIX}(?:[^\s;&|]*\/)?(?:npm${CLI_OPTIONS}(?:rebuild|rb)|pnpm${CLI_OPTIONS}rebuild|yarn${CLI_OPTIONS}rebuild)\b`,
  'i',
)
const INLINE_SHELL_COMMAND_BASE = String.raw`^\s*${SHELL_COMMAND_PREFIX}(?:[^\s;&|]*\/)?(?:sh|bash|dash|zsh)\s+`
const INLINE_SHELL_OPTIONS = String.raw`(?:(?:(?:--(?:rcfile|init-file)|-[oO])[ \t]+(?:'[^']*'|"(?:[^"\\]|\\.)*"|[^\s;&|]+)|--[A-Za-z][A-Za-z0-9-]*(?:=[^\s;&|]+)?|-[A-Za-z]+)[ \t]+)*(?:-[A-Za-z]*c[A-Za-z]*|-[A-Za-z]+\s+-c)`
const INLINE_SHELL_COMMAND = new RegExp(
  String.raw`${INLINE_SHELL_COMMAND_BASE}${INLINE_SHELL_OPTIONS}\s+(?:\$'((?:\\.|[^'\\])*)'|"((?:\\.|[^"\\])*)"|'([^']*)')`,
  'i',
)
const INLINE_SHELL_INVOCATION = new RegExp(String.raw`${INLINE_SHELL_COMMAND_BASE}${INLINE_SHELL_OPTIONS}(?=\s|$)`, 'i')
const PACKAGE_SCRIPT_ACTION = String.raw`(?:run-script\b|run\b|'run'|"run"|'run-script'|"run-script")`
const PACKAGE_SCRIPT_ALIAS = String.raw`(?:test|start|stop|restart)\b`
const PACKAGE_SCRIPT_ARGUMENT = String.raw`[ \t]+(?:--[ \t]+)?(?!--(?:[ \t]|$))[^\s;&|]+`
const PACKAGE_SCRIPT_BUILTINS: Record<'pnpm' | 'yarn' | 'bun', Set<string>> = {
  pnpm: new Set(['add', 'approve-builds', 'audit', 'bin', 'config', 'create', 'deploy', 'dlx', 'env', 'exec', 'fetch', 'help', 'import', 'init', 'install', 'install-test', 'licenses', 'link', 'list', 'outdated', 'pack', 'patch', 'patch-commit', 'prune', 'publish', 'rebuild', 'remove', 'root', 'run', 'server', 'setup', 'start', 'store', 'test', 'unlink', 'update', 'why']),
  yarn: new Set(['access', 'add', 'audit', 'autoclean', 'bin', 'cache', 'check', 'config', 'constraints', 'create', 'dedupe', 'dlx', 'exec', 'global', 'help', 'import', 'info', 'init', 'install', 'licenses', 'link', 'list', 'login', 'logout', 'node', 'npm', 'outdated', 'owner', 'pack', 'patch', 'plugin', 'policies', 'publish', 'remove', 'run', 'self-update', 'set', 'tag', 'team', 'unlink', 'upgrade', 'upgrade-interactive', 'version', 'why', 'workspace', 'workspaces']),
  bun: new Set(['add', 'audit', 'build', 'bun', 'completions', 'create', 'exec', 'help', 'init', 'install', 'link', 'pm', 'remove', 'repl', 'run', 'test', 'update', 'upgrade', 'version', 'x']),
}
const PACKAGE_SCRIPT_OPTIONS_WITH_VALUES: Record<'pnpm' | 'yarn' | 'bun', Set<string>> = {
  pnpm: new Set(['--dir', '-C', '--filter', '-F', '--config']),
  yarn: new Set(['--cwd', '--cache-folder', '--use-yarnrc']),
  bun: new Set(['--cwd', '--filter']),
}
const PACKAGE_SCRIPT_FLAGS = new Set(['--help', '-h', '--version', '-v', '--silent', '-s', '--quiet', '--json', '--offline', '--prefer-offline', '--force', '-r', '--recursive', '-g', '--global', '--production', '--prod', '--dev', '--color', '--no-color', '--frozen-lockfile', '--lockfile-only', '--ignore-scripts'])
const PACKAGE_SCRIPT_COMMAND = new RegExp(
  String.raw`^\s*${SHELL_COMMAND_PREFIX}(?:[^\s;&|]*\/)?(?:` +
    String.raw`(?:'corepack'|"corepack"|corepack)[ \t]+(?:npm${CLI_OPTIONS}(?:${PACKAGE_SCRIPT_ACTION}${PACKAGE_SCRIPT_ARGUMENT}|${PACKAGE_SCRIPT_ALIAS})|(?:pnpm|yarn)${CLI_OPTIONS}(?:(?:run\b|'run'|"run")${PACKAGE_SCRIPT_ARGUMENT}|${PACKAGE_SCRIPT_ALIAS}))` +
    String.raw`|npm${CLI_OPTIONS}(?:${PACKAGE_SCRIPT_ACTION}${PACKAGE_SCRIPT_ARGUMENT}|${PACKAGE_SCRIPT_ALIAS})|(?:pnpm|yarn)${CLI_OPTIONS}(?:(?:run\b|'run'|"run")${PACKAGE_SCRIPT_ARGUMENT}|${PACKAGE_SCRIPT_ALIAS})|bun${CLI_OPTIONS}(?:run\b|'run'|"run")${PACKAGE_SCRIPT_ARGUMENT}` +
  String.raw`)`,
  'i',
)
const PACKAGE_LIFECYCLE_WARNING = 'Package installation or update changes project dependencies and lockfiles. DeepSeek Code only permits supported direct installs and updates with lifecycle scripts disabled; review dependency and lockfile changes before approving.'
const PACKAGE_REBUILD_WARNING = 'Package rebuild commands can execute third-party lifecycle scripts that read or modify files in this workspace. Review the affected package scripts before approving.'
const PACKAGE_SCRIPT_WARNING = 'Package scripts can execute project-defined code that reads or modifies files in this workspace. Review the selected script before approving.'
const CLOUD_TARGET_WARNING = 'Cloud mutation has no literal provider context selector or provider-qualified resource ID and may use ambient identity, account, region, or cluster settings. Confirm the effective destination before approving; this check does not verify the active identity or deployment plan, or bind approval to a deployment plan.'
const CLOUD_EXPLICIT_TARGET_WARNING = 'Cloud mutation includes a literal selector or provider-qualified resource ID, but that selector does not verify the active identity or independently confirm the effective destination. This check does not verify the deployment plan or bind approval to it; verify identity, destination, and plan before approving.'

// shortcut: inspect shell command segments without treating operators inside quotes as separators; use a shell AST before supporting arbitrary shell grammar.
function readCommandSubstitution(command: string, start: number): { body: string; end: number } | undefined {
  let nesting = 1
  let quote: "'" | '"' | null = null
  let escaped = false
  for (let index = start + 2; index < command.length; index++) {
    const char = command[index]!
    if (escaped) { escaped = false; continue }
    if (quote === "'") {
      if (char === "'") quote = null
      continue
    }
    if (char === '\\') { escaped = true; continue }
    if (quote === '"') {
      if (char === '"') quote = null
      continue
    }
    if (char === "'" || char === '"') { quote = char; continue }
    if (char === '(') nesting++
    else if (char === ')' && --nesting === 0) return { body: command.slice(start + 2, index), end: index }
  }
  return undefined
}

function readBacktickSubstitution(command: string, start: number): { body: string; end: number } | undefined {
  let escaped = false
  for (let index = start + 1; index < command.length; index++) {
    const char = command[index]!
    if (escaped) { escaped = false; continue }
    if (char === '\\') { escaped = true; continue }
    if (char === '`') return { body: command.slice(start + 1, index), end: index }
  }
  return undefined
}

interface HereDocument {
  delimiter: string
  stripTabs: boolean
  quoted: boolean
  scriptInput: boolean
}

function readHereDocumentDeclaration(command: string, start: number): { document: HereDocument; end: number } | undefined {
  if (command[start] !== '<' || command[start + 1] !== '<' || command[start + 2] === '<') return undefined
  let index = start + 2
  let stripTabs = false
  if (command[index] === '-') { stripTabs = true; index++ }
  while (command[index] === ' ' || command[index] === '\t') index++

  let delimiter = ''
  let quote: "'" | '"' | null = null
  let quoted = false
  for (; index < command.length; index++) {
    const char = command[index]!
    if (quote === null && /[\s;&|<>()]/.test(char)) break
    if (char === '\\' && quote !== "'") {
      quoted = true
      if (index + 1 < command.length) delimiter += command[++index]!
      continue
    }
    if (char === "'" || char === '"') {
      if (quote === null) { quote = char; quoted = true }
      else if (quote === char) quote = null
      else delimiter += char
      continue
    }
    delimiter += char
  }
  return delimiter ? { document: { delimiter, stripTabs, quoted, scriptInput: false }, end: index } : undefined
}

function readHereDocumentBody(command: string, start: number, document: HereDocument): { body: string; next: number } {
  let lineStart = start
  while (lineStart <= command.length) {
    const newline = command.indexOf('\n', lineStart)
    const lineEnd = newline < 0 ? command.length : newline
    const line = command.slice(lineStart, lineEnd).replace(/\r$/, '')
    const candidate = document.stripTabs ? line.replace(/^\t+/, '') : line
    if (candidate === document.delimiter) {
      return { body: command.slice(start, lineStart), next: newline < 0 ? command.length : newline + 1 }
    }
    if (newline < 0) break
    lineStart = newline + 1
  }
  return { body: command.slice(start), next: command.length }
}

type UnexaminedCommandPolicy = boolean | ((command: string) => boolean)

function failsClosedOnUnexaminedCommand(command: string, policy: UnexaminedCommandPolicy): boolean {
  return typeof policy === 'function' ? policy(command) : policy
}

function hasHereDocumentCommandExpansion(command: string, commandPattern: RegExp | ((segment: string) => boolean), depth: number, unexaminedCommandPolicy: UnexaminedCommandPolicy): boolean {
  let escaped = false
  for (let index = 0; index < command.length; index++) {
    const char = command[index]!
    if (escaped) { escaped = false; continue }
    if (char === '\\') { escaped = true; continue }
    if (char === '$' && command[index + 1] === '(' && command[index + 2] !== '(') {
      const substitution = readCommandSubstitution(command, index)
      if (substitution) {
        if (depth >= 3 && failsClosedOnUnexaminedCommand(substitution.body, unexaminedCommandPolicy)) return true
        if (depth < 3 && hasShellCommandAfterControlFlow(substitution.body, commandPattern, depth + 1, unexaminedCommandPolicy)) return true
        index = substitution.end
        continue
      }
    }
    if (char === '`') {
      const substitution = readBacktickSubstitution(command, index)
      if (substitution) {
        const body = substitution.body.replace(/\\`/g, '`')
        if (depth >= 3 && failsClosedOnUnexaminedCommand(body, unexaminedCommandPolicy)) return true
        if (depth < 3 && hasShellCommandAfterControlFlow(body, commandPattern, depth + 1, unexaminedCommandPolicy)) return true
        index = substitution.end
      }
    }
  }
  return false
}

function removeShellLineContinuations(command: string): string {
  let normalized = ''
  let quote: "'" | '"' | null = null
  let escaped = false
  for (let index = 0; index < command.length; index++) {
    const char = command[index]!
    if (quote === "'") {
      normalized += char
      if (char === "'") quote = null
      continue
    }
    if (escaped) {
      normalized += char
      escaped = false
      continue
    }
    if (char === '\\') {
      if (command[index + 1] === '\n') {
        index++
        continue
      }
      if (command[index + 1] === '\r' && command[index + 2] === '\n') {
        index += 2
        continue
      }
      normalized += char
      escaped = true
      continue
    }
    if (char === "'" && quote === null) quote = "'"
    else if (char === '"') quote = quote === '"' ? null : '"'
    normalized += char
  }
  return normalized
}

function hasShellCommandAfterControlFlow(command: string, commandPattern: RegExp | ((segment: string) => boolean), depth = 0, unexaminedCommandPolicy: UnexaminedCommandPolicy = false): boolean {
  command = removeShellLineContinuations(command)
  const matchesCommand = typeof commandPattern === 'function' ? commandPattern : (segment: string) => commandPattern.test(segment)
  const hereDocuments: HereDocument[] = []
  const matchesCommandSegment = (start: number, end: number) => {
    let segment = command.slice(start, end).trimStart()
    while (segment) {
      const controlWord = segment.match(/^(?:if|elif|else|while|until|then|do)\b\s*/i)
      if (controlWord) segment = segment.slice(controlWord[0].length)
      else if (segment.startsWith('!')) segment = segment.slice(1).trimStart()
      else if (segment.startsWith('{') && /\s/.test(segment[1] ?? '')) segment = segment.slice(1).trimStart()
      else break
    }
    if (matchesCommand(segment)) return true
    const inlineShellMatch = INLINE_SHELL_COMMAND.exec(segment)
    const inlineShellInvocation = INLINE_SHELL_INVOCATION.test(segment)
    const envSplitString = getEnvSplitStringCommand(segment)
    const envSplitStringInvocation = hasEnvSplitStringInvocation(segment)
    const evalCommand = getLiteralEvalCommand(segment)
    const evalInvocation = isEvalInvocation(segment)
    const hereString = getShellHereStringCommand(segment)
    const hereStringInvocation = isShellHereStringInvocation(segment)
    const inlineShellBody = getInlineShellCommandBody(segment, inlineShellMatch)
    const hasWrapper = inlineShellInvocation || envSplitStringInvocation || evalInvocation || hereStringInvocation
    if (depth >= 3) return hasWrapper && failsClosedOnUnexaminedCommand(segment, unexaminedCommandPolicy)

    if (envSplitStringInvocation) {
      if (envSplitString === undefined) return failsClosedOnUnexaminedCommand(segment, unexaminedCommandPolicy)
      if (hasShellCommandAfterControlFlow(envSplitString, matchesCommand, depth + 1, unexaminedCommandPolicy)) return true
    }
    if (evalInvocation) {
      if (evalCommand === undefined) return failsClosedOnUnexaminedCommand(segment, unexaminedCommandPolicy)
      if (hasShellCommandAfterControlFlow(evalCommand, matchesCommand, depth + 1, unexaminedCommandPolicy)) return true
    }
    if (hereStringInvocation) {
      if (hereString === undefined) return failsClosedOnUnexaminedCommand(segment, unexaminedCommandPolicy)
      if (hasShellCommandAfterControlFlow(hereString, matchesCommand, depth + 1, unexaminedCommandPolicy)) return true
    }
    if (inlineShellInvocation) {
      if (inlineShellBody === undefined) return failsClosedOnUnexaminedCommand(segment, unexaminedCommandPolicy)
      if (hasShellCommandAfterControlFlow(inlineShellBody, matchesCommand, depth + 1, unexaminedCommandPolicy)) return true
    }
    return false
  }
  let start = 0
  let quote: "'" | '"' | null = null
  let escaped = false
  for (let index = 0; index < command.length; index++) {
    const char = command[index]!
    if (escaped) { escaped = false; continue }
    if (quote === "'") {
      if (char === "'") quote = null
      continue
    }
    if (char === '\\') { escaped = true; continue }
    if (quote !== '"' && char === '#' && (index === 0 || /[\s;&|()]/.test(command[index - 1]!))) {
      const newline = command.indexOf('\n', index)
      if (matchesCommandSegment(start, index)) return true
      if (newline < 0) return false
      start = newline
      index = newline - 1
      continue
    }
    if (quote !== '"' && char === '<' && command[index + 1] === '<') {
      const declaration = readHereDocumentDeclaration(command, index)
      if (declaration) {
        hereDocuments.push({
          ...declaration.document,
          scriptInput: isShellReadingScriptFromStdin(command.slice(start, index)),
        })
        index = declaration.end - 1
        continue
      }
    }
    if (char === '$' && command[index + 1] === '(' && command[index + 2] !== '(') {
      const substitution = readCommandSubstitution(command, index)
      if (substitution) {
        if (depth >= 3 && failsClosedOnUnexaminedCommand(substitution.body, unexaminedCommandPolicy)) return true
        if (depth < 3 && hasShellCommandAfterControlFlow(substitution.body, matchesCommand, depth + 1, unexaminedCommandPolicy)) return true
        index = substitution.end
        continue
      }
    }
    if (char === '`') {
      const substitution = readBacktickSubstitution(command, index)
      if (substitution) {
        // One escape layer protects nested legacy substitutions from their parent delimiter.
        const body = substitution.body.replace(/\\`/g, '`')
        if (depth >= 3 && failsClosedOnUnexaminedCommand(body, unexaminedCommandPolicy)) return true
        if (depth < 3 && hasShellCommandAfterControlFlow(body, matchesCommand, depth + 1, unexaminedCommandPolicy)) return true
        index = substitution.end
        continue
      }
    }
    if (quote === '"') {
      if (char === '"') quote = null
      continue
    }
    if (char === "'" || char === '"') { quote = char; continue }
    if (char === ';' || char === '&' || char === '|' || char === '\n' || char === '(' || char === ')') {
      if (matchesCommandSegment(start, index)) return true
      if (char === '\n' && hereDocuments.length > 0) {
        let next = index + 1
        for (const document of hereDocuments) {
          const body = readHereDocumentBody(command, next, document)
          if (document.scriptInput) {
            if (depth >= 3 && failsClosedOnUnexaminedCommand(body.body, unexaminedCommandPolicy)) return true
            if (depth < 3 && hasShellCommandAfterControlFlow(body.body, matchesCommand, depth + 1, unexaminedCommandPolicy)) return true
          }
          if (!document.quoted && hasHereDocumentCommandExpansion(body.body, matchesCommand, depth, unexaminedCommandPolicy)) return true
          next = body.next
        }
        hereDocuments.length = 0
        start = next
        index = next - 1
        continue
      }
      if ((char === '&' || char === '|') && command[index + 1] === char) index++
      start = index + 1
    }
  }
  return matchesCommandSegment(start, command.length)
}

function hasPackageInstallCapability(command: string, depth = 0): boolean {
  return hasShellCommandAfterControlFlow(command, PACKAGE_INSTALL_COMMAND, depth, body =>
    /[;&|()<>`$\n\r]/.test(body) || !PACKAGE_LIFECYCLE_SCRIPT_COMMAND.test(body.trim()),
  )
}

interface ShellWord {
  value: string
  literal: boolean
}

const CLOUD_MUTATING_VERBS = new Set([
  'add', 'apply', 'attach', 'authorize', 'cancel', 'cordon', 'cp', 'create', 'delete', 'deploy', 'destroy', 'detach',
  'disable', 'disassociate', 'drain', 'enable', 'expose', 'import', 'label', 'modify', 'patch', 'put',
  'mv', 'remove', 'replace', 'revoke', 'rm', 'scale', 'set', 'start', 'stop', 'sync', 'taint', 'terminate', 'undeploy',
  'untaint', 'update', 'up', 'upgrade',
])
const KUBECTL_OPTIONS_WITH_VALUES = new Set([
  '-n', '-f', '-k', '-l', '--context', '--cluster', '--namespace', '--server', '--kubeconfig', '--token',
  '--user', '--as', '--as-group', '--request-timeout', '--certificate-authority', '--client-certificate', '--client-key',
])
const KUBECTL_MUTATING_VERBS = new Set([
  'apply', 'create', 'delete', 'edit', 'label', 'patch', 'replace', 'scale', 'set', 'taint', 'uncordon', 'cordon',
  'drain', 'rollout', 'expose', 'run',
])
const TERRAFORM_OPTIONS_WITH_VALUES = new Set(['-chdir'])
const PULUMI_OPTIONS_WITH_VALUES = new Set([
  '--stack', '-s', '--cwd', '-C', '--config', '--parallel', '--message', '--color', '--memprofilerate',
  '--otel-traces', '--profiling', '--tracing', '--verbose', '-v',
])
const SHELL_LITERAL_VALUE = /^[A-Za-z0-9][A-Za-z0-9._:/@+=,-]*$/
const CLOUD_CONTEXT_FLAGS: Record<string, Set<string>> = {
  aws: new Set(['--profile', '--region']),
  gcloud: new Set(['--account', '--project', '--project-id', '--region', '--zone']),
  az: new Set(['--location', '--subscription', '--tenant']),
  eksctl: new Set(['--profile', '--region']),
  kubectl: new Set(['--cluster', '--context', '--server']),
  pulumi: new Set(['--stack', '-s']),
}
const CLOUD_CONTEXT_ASSIGNMENTS: Record<string, Set<string>> = {
  aws: new Set(['AWS_PROFILE', 'AWS_DEFAULT_PROFILE', 'AWS_REGION', 'AWS_DEFAULT_REGION']),
  gcloud: new Set(['CLOUDSDK_CORE_PROJECT', 'CLOUDSDK_COMPUTE_REGION', 'CLOUDSDK_COMPUTE_ZONE', 'GOOGLE_CLOUD_PROJECT']),
  az: new Set(['AZURE_SUBSCRIPTION_ID', 'ARM_SUBSCRIPTION_ID']),
  eksctl: new Set(['AWS_PROFILE', 'AWS_DEFAULT_PROFILE', 'AWS_REGION', 'AWS_DEFAULT_REGION']),
}
const NETWORK_CAPABILITY_PATTERNS = [
  /\b(?:https?|ftp|ssh):\/\/[^\s'"`]+/i,
  /\/dev\/(?:tcp|udp)\//i,
  /(?:^|[;&|\n]\s*|\$\(\s*)(?:curl|wget|aria2c|httpie|nc|netcat|ncat|socat|telnet|ftp|ssh|scp|sftp)\b/i,
  /\b(?:fetch|axios|requests?\.(?:get|post|put|delete|request)|urllib(?:\.request)?|https?\.request|socket(?:\.create_connection)?)\s*[(.]/i,
  /\bgit\s+(?:clone|fetch|pull|push)\b/i,
]

function isCloudMutationVerb(value: string): boolean {
  const verb = value.toLowerCase()
  return CLOUD_MUTATING_VERBS.has(verb) || CLOUD_MUTATING_VERBS.has(verb.split('-')[0]!)
}

function kubectlMutationIndex(args: ShellWord[]): number {
  for (let index = 0; index < args.length; index++) {
    const value = args[index]!.value.toLowerCase()
    if (value.startsWith('-')) {
      if (KUBECTL_OPTIONS_WITH_VALUES.has(value)) index++
      continue
    }
    if (KUBECTL_MUTATING_VERBS.has(value)) return index
    if (index > 8) break
  }
  return -1
}

function firstCloudSubcommandIndex(args: ShellWord[], optionsWithValues: Set<string>): number {
  for (let index = 0; index < args.length; index++) {
    const value = args[index]!.value
    if (value === '--') return index + 1 < args.length ? index + 1 : -1
    if (value.startsWith('-')) {
      const flag = value.includes('=') ? value.slice(0, value.indexOf('=')) : value
      if (optionsWithValues.has(flag) && flag === value) index++
      continue
    }
    return index
  }
  return -1
}

// shortcut: accept only literal selectors and common cloud CLI verbs; use a shell AST before supporting computed target expressions.
function parseShellWords(command: string): ShellWord[] {
  const words: ShellWord[] = []
  let value = ''
  let literal = true
  let quote: "'" | '"' | null = null
  let escaped = false
  let started = false
  let windowsDrivePath = false
  const push = () => {
    if (started) words.push({ value, literal })
    value = ''
    literal = true
    started = false
    windowsDrivePath = false
  }
  for (let index = 0; index < command.length; index++) {
    const char = command[index]!
    if (escaped) { value += char; started = true; escaped = false; continue }
    if (char === '\\' && quote !== "'") {
      const next = command[index + 1]
      const startsWindowsDrivePath = /^[A-Za-z]:$/.test(value) && next !== undefined && !/[\s;&|()<>]/.test(next)
      if (windowsDrivePath || startsWindowsDrivePath) {
        windowsDrivePath = true
        value += char
        started = true
        continue
      }
      escaped = true
      started = true
      continue
    }
    if (quote === "'") {
      if (char === "'") quote = null
      else value += char
      started = true
      continue
    }
    if (char === '"') { quote = quote === '"' ? null : '"'; started = true; continue }
    if (char === "'" && quote === null) { quote = "'"; started = true; continue }
    if (quote === null && /\s/.test(char)) { push(); continue }
    if (char === '$' || char === '`') literal = false
    value += char
    started = true
  }
  if (escaped) value += '\\'
  push()
  return words
}

const SHELL_STDIN_INTERPRETERS = new Set(['sh', 'bash', 'dash', 'zsh'])
const SHELL_OPTIONS_WITH_VALUES = new Set(['-O', '-o', '--rcfile', '--init-file'])
const ENV_OPTIONS_WITH_VALUES = new Set(['-u', '--unset', '-C', '--chdir'])
const ENV_SPLIT_STRING_OPTIONS = new Set(['-S', '--split-string'])

function stripLeadingShellControlWords(command: string): string {
  let segment = command.trimStart()
  while (segment) {
    const controlWord = segment.match(/^(?:if|elif|else|while|until|then|do)\b\s*/i)
    if (controlWord) segment = segment.slice(controlWord[0].length)
    else if (segment.startsWith('!')) segment = segment.slice(1).trimStart()
    else if (segment.startsWith('{') && /\s/.test(segment[1] ?? '')) segment = segment.slice(1).trimStart()
    else break
  }
  return segment
}

function shellCommandWords(command: string): ShellWord[] {
  const segment = stripLeadingShellControlWords(command)
  const prefix = new RegExp('^\\s*' + SHELL_COMMAND_PREFIX, 'i').exec(segment)?.[0] ?? ''
  return parseShellWords(segment.slice(prefix.length))
}

function packageManagerName(value: string | undefined): string | undefined {
  return value?.split(/[\\/]/).pop()?.toLowerCase().replace(/\.(?:exe|cmd|bat)$/, '').split('@')[0]
}

function isPackageScriptShorthand(segment: string): boolean {
  const words = shellCommandWords(segment)
  let index = 0
  let manager = packageManagerName(words[index]?.value)
  if (manager === 'corepack') {
    index++
    while (words[index]?.value.startsWith('-')) {
      const option = words[index]!.value.split('=', 1)[0]!
      index += option === '--install-directory' && !words[index]!.value.includes('=') ? 2 : 1
    }
    manager = packageManagerName(words[index]?.value)
  }
  if (manager !== 'pnpm' && manager !== 'yarn' && manager !== 'bun') return false
  index++

  while (index < words.length) {
    const value = words[index]!.value
    if (value === '--') { index++; break }
    if (!value.startsWith('-')) break
    const option = value.split('=', 1)[0]!
    if (PACKAGE_SCRIPT_FLAGS.has(option)) { index++; continue }
    if (PACKAGE_SCRIPT_OPTIONS_WITH_VALUES[manager].has(option)) {
      index += value.includes('=') ? 1 : 2
      continue
    }
    return true
  }

  const script = words[index]
  if (!script) return false
  if (!script.literal) return true
  if (manager === 'bun' && (/[\\/]/.test(script.value) || /\.(?:[cm]?[jt]sx?|jsonc?|wasm|sh|py|rb|pl|php|go|rs|java|kt|swift|c|cc|cpp|h|hpp)$/i.test(script.value))) return false
  if (/[\\/]/.test(script.value)) return true
  return !PACKAGE_SCRIPT_BUILTINS[manager].has(script.value.toLowerCase())
}

/** Classifies dependency installs and updates before execution; unsupported forms fail closed. */
export function packageInstallLifecyclePolicy(command: string, packageManagerPin?: string): 'not-install' | 'safe' | 'blocked' {
  if (!hasPackageInstallCapability(command) && !hasDirectPackageInstallInvocation(command)) return 'not-install'
  if (/[;&|()<>`\n\r]/.test(command)) return 'blocked'

  const words = parseShellWords(command)
  const manager = words[0]?.value.toLowerCase()
  if (!manager || words[0]?.value !== manager || !['npm', 'pnpm', 'bun', 'yarn'].includes(manager) || words.some(word => !word.literal)) return 'blocked'

  let operationIndex = 1
  const leadingOptions: string[] = []
  while (words[operationIndex]?.value === '--ignore-scripts' || manager === 'yarn' && words[operationIndex]?.value.startsWith('--mode=')) {
    leadingOptions.push(words[operationIndex]!.value)
    operationIndex++
  }
  const operation = words[operationIndex]?.value.toLowerCase()
  if (!operation || !['install', 'i', 'ci', 'clean-install', 'it', 'install-test', 'cit', 'clean-install-test', 'add', 'update', 'up', 'upgrade'].includes(operation)) return 'blocked'
  // npm install-test and clean-install-test also run test lifecycle scripts; an install flag cannot neutralize that composite.
  if (manager === 'npm' && ['it', 'install-test', 'cit', 'clean-install-test'].includes(operation)) return 'blocked'
  const options = [...leadingOptions]
  for (const word of words.slice(operationIndex + 1)) {
    if (word.value === '--') break
    options.push(word.value)
  }

  const hasIgnoreScripts = options.includes('--ignore-scripts')
  const explicitlyEnablesScripts = options.some(option => /^--ignore-scripts=(?:false|0)$/i.test(option))
  const separatedFalse = options.some((option, index) => option === '--ignore-scripts' && /^(?:false|0)$/i.test(options[index + 1] ?? ''))
  const explicitlyNegatesScripts = options.some(option => /^--no-ignore-scripts(?:=|$)/i.test(option))
  if (explicitlyEnablesScripts || separatedFalse || explicitlyNegatesScripts) return 'blocked'

  if (manager !== 'yarn') return hasIgnoreScripts ? 'safe' : 'blocked'
  const yarnMajor = Number(/^yarn@(\d+)\.\d+\.\d+(?:\+[^\s]+)?$/.exec(packageManagerPin ?? '')?.[1])
  if (!Number.isInteger(yarnMajor) || yarnMajor < 1) return 'blocked'
  if (yarnMajor === 1) return hasIgnoreScripts ? 'safe' : 'blocked'
  // Yarn Berry skip-build does not suppress every install-time script hook.
  return 'blocked'
}

function hasDirectPackageInstallInvocation(command: string): boolean {
  return hasShellCommandAfterControlFlow(command, segment => {
    const words = shellCommandWords(segment)
    const manager = words[0]?.value.split(/[\\/]/).pop()?.toLowerCase().replace(/\.exe$/, '')
    if (manager === 'corepack') {
      let managerIndex = 1
      while (words[managerIndex]?.value.startsWith('-')) {
        if (words[managerIndex]!.value === '--install-directory') managerIndex++
        managerIndex++
      }
      const delegatedManager = words[managerIndex]?.value.toLowerCase().split('@')[0]
      let actionIndex = managerIndex + 1
      while (words[actionIndex]?.value.startsWith('-')) {
        const option = words[actionIndex]!.value.split('=', 1)[0]!
        if (words[actionIndex]!.value === option && PACKAGE_MANAGER_OPTIONS_WITH_VALUES[delegatedManager ?? '']?.has(option)) actionIndex++
        actionIndex++
      }
      const delegatedAction = words[actionIndex]
      return ['npm', 'pnpm', 'yarn'].includes(delegatedManager ?? '')
        && (!delegatedAction?.literal || ['install', 'i', 'ci', 'clean-install', 'it', 'install-test', 'cit', 'clean-install-test', 'add', 'exec', 'dlx', 'update', 'up', 'upgrade'].includes(delegatedAction?.value.toLowerCase() ?? ''))
    }
    if (!manager || !PACKAGE_MANAGER_OPTIONS_WITH_VALUES[manager]) return false

    const args = words.slice(1)
    for (let index = 0; index < args.length; index++) {
      const value = args[index]!.value.toLowerCase()
      if (value === '--') return false
      if (!args[index]!.literal) return true
      if (value.startsWith('-')) {
        const flag = value.includes('=') ? value.slice(0, value.indexOf('=')) : value
        if (value === flag && PACKAGE_MANAGER_OPTIONS_WITH_VALUES[manager]!.has(flag)) index++
        continue
      }
      return ['install', 'i', 'ci', 'clean-install', 'it', 'install-test', 'cit', 'clean-install-test', 'add'].includes(value)
    }
    return false
  })
}

function isShellReadingScriptFromStdin(command: string): boolean {
  const envSplitString = getEnvSplitStringCommand(command)
  if (envSplitString) return isShellReadingScriptFromStdin(envSplitString)
  const words = shellCommandWords(command)
  const executable = words[0]?.value.split(/[\\/]/).pop()?.toLowerCase().replace(/\.exe$/, '')
  if (!executable || !SHELL_STDIN_INTERPRETERS.has(executable)) return false

  const args = words.slice(1)
  let stdinMode = false
  for (let index = 0; index < args.length; index++) {
    const value = args[index]!.value
    if (value === '--') return stdinMode
    if (value.startsWith('-')) {
      if (/^-[A-Za-z]*c[A-Za-z]*$/.test(value)) return false
      if (/^-[A-Za-z]*s[A-Za-z]*$/.test(value)) stdinMode = true
      if (SHELL_OPTIONS_WITH_VALUES.has(value)) index++
      continue
    }
    if (!stdinMode) return false
  }
  return true
}

function getEnvSplitStringCommand(command: string): string | undefined {
  const words = parseShellWords(command)
  const executable = words[0]?.value.split(/[\\/]/).pop()?.toLowerCase().replace(/\.exe$/, '')
  if (executable !== 'env') return undefined

  for (let index = 1; index < words.length; index++) {
    const value = words[index]!.value
    let splitString: ShellWord | undefined
    let tailStart = index + 1
    if (ENV_SPLIT_STRING_OPTIONS.has(value)) {
      splitString = words[index + 1]
      tailStart = index + 2
    } else if (value.startsWith('--split-string=')) {
      splitString = { value: value.slice('--split-string='.length), literal: words[index]!.literal }
    } else if (value.startsWith('-S') && value.length > 2) {
      splitString = { value: value.slice(2), literal: words[index]!.literal }
    }
    if (splitString) {
      if (!splitString.literal) return undefined
      return [splitString.value, ...words.slice(tailStart).map(word => word.value)].filter(Boolean).join(' ')
    }
    if (ENV_OPTIONS_WITH_VALUES.has(value)) index++
    else if (value.startsWith('-')) continue
    else if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(value)) continue
    else return undefined
  }
  return undefined
}

function getLiteralEvalCommand(command: string): string | undefined {
  const words = shellCommandWords(command)
  const executable = words[0]?.value.split(/[\\/]/).pop()?.toLowerCase().replace(/\.exe$/, '')
  const args = words.slice(1)
  if (executable !== 'eval' || args.length === 0 || args.some(word => !word.literal)) return undefined
  return args.map(word => word.value).join(' ')
}

function getShellHereStringCommand(command: string): string | undefined {
  const hereStringIndex = command.indexOf('<<<')
  if (hereStringIndex < 0 || !isShellReadingScriptFromStdin(command.slice(0, hereStringIndex))) return undefined
  const words = parseShellWords(command.slice(hereStringIndex + 3))
  if (words.length !== 1 || !words[0]!.literal) return undefined
  return words[0]!.value
}

function getInlineShellCommandBody(segment: string, match: RegExpExecArray | null): string | undefined {
  if (!match) return undefined
  const nextCharacter = segment[match.index + match[0].length]
  let suffix = ''
  if (nextCharacter !== undefined && !/\s/.test(nextCharacter)) {
    const continuation = decodeAdjacentShellWord(segment, match.index + match[0].length)
    if (continuation === undefined) return undefined
    suffix = continuation
  }
  const ansiCBody = match[1]
  if (ansiCBody !== undefined) {
    // Bash ANSI-C escapes can synthesize shell syntax, so only inspect the unescaped literal subset.
    return /^[\x20-\x7E]*$/.test(ansiCBody) && !ansiCBody.includes('\\') ? ansiCBody + suffix : undefined
  }
  if (match[2] !== undefined) return match[2].replace(/\\(["\\$`])/g, '$1') + suffix
  return match[3] === undefined ? undefined : match[3] + suffix
}

function decodeAdjacentShellWord(command: string, start: number): string | undefined {
  let decoded = ''
  let quote: "'" | '"' | 'ansi-c' | null = null
  let consumed = false
  for (let index = start; index < command.length; index++) {
    const char = command[index]!
    if (quote === 'ansi-c') {
      if (char === "'") quote = null
      else if (char === '\\' || !/[\x20-\x7E]/.test(char)) return undefined
      else decoded += char
      consumed = true
      continue
    }
    if (quote === "'") {
      if (char === "'") quote = null
      else decoded += char
      consumed = true
      continue
    }
    if (char === '\\') {
      const next = command[++index]
      if (next === undefined) return undefined
      if (quote === '"' && !/["\\$`\n]/.test(next)) decoded += '\\'
      if (next !== '\n') decoded += next
      consumed = true
      continue
    }
    if (quote === '"') {
      if (char === '"') quote = null
      else decoded += char
      consumed = true
      continue
    }
    if (/\s/.test(char)) break
    if (char === '$' && command[index + 1] === "'") {
      quote = 'ansi-c'
      index++
    } else if (char === "'") quote = "'"
    else if (char === '"') quote = '"'
    else decoded += char
    consumed = true
  }
  return consumed && quote === null ? decoded : undefined
}

function hasEnvSplitStringInvocation(command: string): boolean {
  const isSplitStringCommand = (words: ShellWord[]) => {
    const executable = words[0]?.value.split(/[\\/]/).pop()?.toLowerCase().replace(/\.exe$/, '')
    return executable === 'env' && words.slice(1).some(({ value }) =>
      ENV_SPLIT_STRING_OPTIONS.has(value) || value.startsWith('-S') && value.length > 2 || value.startsWith('--split-string='),
    )
  }
  return isSplitStringCommand(parseShellWords(command)) || isSplitStringCommand(shellCommandWords(command))
}

function isEvalInvocation(command: string): boolean {
  const executable = shellCommandWords(command)[0]?.value.split(/[\\/]/).pop()?.toLowerCase().replace(/\.exe$/, '')
  return executable === 'eval'
}

function isShellHereStringInvocation(command: string): boolean {
  const hereStringIndex = command.indexOf('<<<')
  return hereStringIndex >= 0 && isShellReadingScriptFromStdin(command.slice(0, hereStringIndex))
}

function hasLiteralFlagValue(words: ShellWord[], flags: Set<string>): boolean {
  for (let index = 0; index < words.length; index++) {
    const word = words[index]!
    if (!word.literal) continue
    const equals = word.value.indexOf('=')
    const flag = equals < 0 ? word.value : word.value.slice(0, equals)
    const inlineValue = equals < 0 ? undefined : word.value.slice(equals + 1)
    if (!flags.has(flag)) continue
    const value = inlineValue === undefined ? words[index + 1] : { value: inlineValue, literal: word.literal }
    if (value?.literal && SHELL_LITERAL_VALUE.test(value.value)) return true
  }
  return false
}

function hasLiteralContextAssignment(cli: string, prefix: ShellWord[]): boolean {
  const names = CLOUD_CONTEXT_ASSIGNMENTS[cli]
  if (!names) return false
  return prefix.some(word => {
    if (!word.literal) return false
    const assignment = /^([A-Za-z_][A-Za-z0-9_]*)=([\s\S]+)$/.exec(word.value)
    return !!assignment && names.has(assignment[1]!) && SHELL_LITERAL_VALUE.test(assignment[2]!)
  })
}

function hasProviderQualifiedResourceId(cli: string, words: ShellWord[]): boolean {
  const values = words.filter(word => word.literal).flatMap(word => word.value.split('=').slice(-1))
  if (cli === 'aws') return values.some(value => /^arn:(?:aws|aws-us-gov|aws-cn):[a-z0-9-]+:[a-z0-9-]*:\d{12}:.+$/i.test(value))
  if (cli === 'gcloud') return values.some(value => /(?:^|\/)projects\/[A-Za-z0-9._:-]+\/(?:regions|zones|locations)\/[A-Za-z0-9-]+\/[^\s]+/i.test(value))
  if (cli === 'az') return values.some(value => /^\/?subscriptions\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\/resourcegroups\/[^/]+\/providers\/[^/]+\/[^/]+\/[^/]+/i.test(value))
  return false
}

function getCloudMutationTarget(command: string): { cli: string; explicitTarget: boolean } | undefined {
  const prefix = new RegExp(String.raw`^\s*${SHELL_COMMAND_PREFIX}`, 'i')
  const prefixText = prefix.exec(command)?.[0] ?? ''
  const prefixWords = parseShellWords(prefixText)
  const words = parseShellWords(command.slice(prefixText.length))
  const executable = words[0]?.value.split(/[\\/]/).pop()?.toLowerCase().replace(/\.exe$/, '')
  if (!executable) return undefined
  const args = words.slice(1)
  let mutationIndex = -1

  if (executable === 'aws') {
    mutationIndex = args.findIndex((word, index) => index >= 1 && index <= 10 && word.literal && isCloudMutationVerb(word.value))
  } else if (executable === 'gcloud' || executable === 'az' || executable === 'eksctl') {
    mutationIndex = args.findIndex((word, index) => index >= 1 && index <= 8 && word.literal && isCloudMutationVerb(word.value))
  } else if (executable === 'kubectl') {
    mutationIndex = kubectlMutationIndex(args)
  } else if (executable === 'terraform') {
    const subcommandIndex = firstCloudSubcommandIndex(args, TERRAFORM_OPTIONS_WITH_VALUES)
    const subcommand = args[subcommandIndex]?.value.toLowerCase()
    mutationIndex = args[subcommandIndex]?.literal && new Set(['apply', 'destroy', 'import', 'taint', 'untaint']).has(subcommand ?? '') ? subcommandIndex
      : subcommand === 'workspace' && args[subcommandIndex + 1]?.value === 'delete' ? subcommandIndex + 1
        : subcommand === 'state' && ['rm', 'mv', 'push'].includes(args[subcommandIndex + 1]?.value ?? '') ? subcommandIndex + 1 : -1
  } else if (executable === 'pulumi') {
    const subcommandIndex = firstCloudSubcommandIndex(args, PULUMI_OPTIONS_WITH_VALUES)
    const subcommand = args[subcommandIndex]?.value.toLowerCase()
    mutationIndex = args[subcommandIndex]?.literal && new Set(['up', 'destroy', 'import', 'refresh', 'remove', 'cancel']).has(subcommand ?? '') ? subcommandIndex
      : subcommand === 'state' && args[subcommandIndex + 1]?.value === 'delete' ? subcommandIndex + 1 : -1
  }
  if (mutationIndex < 0) return undefined

  const contextFlags = CLOUD_CONTEXT_FLAGS[executable]
  const explicitContext = (contextFlags !== undefined && hasLiteralFlagValue(words, contextFlags))
    || hasLiteralContextAssignment(executable, prefixWords)
  const explicitTarget = explicitContext || hasProviderQualifiedResourceId(executable, args)
  return { cli: executable, explicitTarget }
}

/** Detects recognized cloud CLI mutations whose destination is implicit or computed. */
export function hasImplicitCloudMutationTarget(command: string): boolean {
  return hasShellCommandAfterControlFlow(command, segment => {
    const mutation = getCloudMutationTarget(segment)
    return mutation !== undefined && !mutation.explicitTarget
  })
}

function hasCloudMutation(command: string): boolean {
  return hasShellCommandAfterControlFlow(command, segment => getCloudMutationTarget(segment) !== undefined)
}

/** Detect npm commands that rerun package lifecycle scripts without implying network access. */
export function hasPackageLifecycleScriptExecution(command: string): boolean {
  return hasShellCommandAfterControlFlow(command, PACKAGE_LIFECYCLE_SCRIPT_COMMAND, 0, true)
}

/** Detect explicit package-manager run commands without assuming they access the network. */
export function hasPackageScriptExecution(command: string): boolean {
  return hasShellCommandAfterControlFlow(command, segment => PACKAGE_SCRIPT_COMMAND.test(segment) || isPackageScriptShorthand(segment))
}

/**
 * Detect network capability, rather than relying on a blacklist of command
 * names. Transport syntax and common client APIs are covered as well.
 */
export function hasNetworkCapability(toolName: string, args: Record<string, unknown>): boolean {
  const normalizedTool = toolName.toLowerCase()
  if (normalizedTool === 'web_fetch') return true
  if (normalizedTool === 'git') return args.action === 'push' || args.action === 'pull'
  if (normalizedTool === 'browser') {
    // Navigating to anything but this machine reaches the network; loopback is gated per origin by permissions.
    const navigations = args.action === 'batch' && Array.isArray(args.steps) ? args.steps as Array<Record<string, unknown>> : [args]
    return navigations.some(step => step?.action === 'navigate' && !isLoopbackOrigin(originOf(step.url) ?? 'about:blank'))
  }
  if (normalizedTool !== 'shell' || typeof args.command !== 'string') return false

  const command = args.command
  if (hasPackageInstallCapability(command) || hasDirectPackageInstallInvocation(command)) return true
  if (hasCloudMutation(command)) return true
  return hasShellCommandAfterControlFlow(command, segment => NETWORK_CAPABILITY_PATTERNS.some(pattern => pattern.test(segment)))
}

// ── Default Risk Rules ───────────────────────────────────────────────────────

export const DEFAULT_RISK_RULES: RiskRule[] = [
  // HIGH — always require confirmation
  { id: 'shell:rm', level: 'high', tool: 'shell', pattern: 'rm *' },
  { id: 'shell:rm-rf', level: 'high', tool: 'shell', pattern: 'rm -rf *' },
  { id: 'shell:force-push', level: 'high', tool: 'shell', pattern: 'git push *--force*' },
  { id: 'shell:force-push-f', level: 'high', tool: 'shell', pattern: 'git push * -f *' },
  { id: 'shell:force-push-f-end', level: 'high', tool: 'shell', pattern: 'git push * -f' },
  { id: 'shell:force-push-f-imm', level: 'high', tool: 'shell', pattern: 'git push -f *' },
  { id: 'shell:force-push-f-bare', level: 'high', tool: 'shell', pattern: 'git push -f' },
  { id: 'shell:reset-hard', level: 'high', tool: 'shell', pattern: 'git reset --hard*' },
  { id: 'shell:checkout-destructive', level: 'high', tool: 'shell', pattern: 'git checkout -- *' },
  { id: 'shell:clean', level: 'high', tool: 'shell', pattern: 'git clean *' },
  { id: 'shell:sudo', level: 'high', tool: 'shell', pattern: 'sudo *' },
  { id: 'shell:systemctl', level: 'high', tool: 'shell', pattern: 'systemctl *' },
  { id: 'shell:docker-rm', level: 'high', tool: 'shell', pattern: 'docker *--rm*' },
  { id: 'shell:chmod', level: 'high', tool: 'shell', pattern: 'chmod *' },
  { id: 'shell:deploy-run', level: 'high', tool: 'shell', pattern: '*run deploy*' },
  { id: 'shell:deploy-script', level: 'high', tool: 'shell', pattern: '*deploy.sh*' },
  { id: 'shell:deploy-cmd', level: 'high', tool: 'shell', pattern: '*serverless deploy*' },
  { id: 'shell:deploy-cdk', level: 'high', tool: 'shell', pattern: 'cdk deploy*' },
  { id: 'shell:build', level: 'high', tool: 'shell', pattern: 'bun run build*' },
  { id: 'git:force-push', level: 'high', tool: 'git', pattern: 'push --force' },
  { id: 'git:push', level: 'high', tool: 'git', pattern: 'push' },
  { id: 'git:pull', level: 'high', tool: 'git', pattern: 'pull' },
  { id: 'write:deepseek-config', level: 'high', tool: 'write_file', pattern: '*.deepseek/*' },
  { id: 'patch:deepseek-config', level: 'high', tool: 'patch_file', pattern: '*.deepseek/*' },
  { id: 'edit:deepseek-config', level: 'high', tool: 'edit_file', pattern: '*.deepseek/*' },
  { id: 'write:steering', level: 'high', tool: 'write_file', pattern: '*.deepseek/steering/*' },
  { id: 'edit:steering', level: 'high', tool: 'edit_file', pattern: '*.deepseek/steering/*' },
  { id: 'write:large-overwrite', level: 'high', tool: 'write_file', condition: 'large_overwrite', description: 'Replaces the entire contents of an existing large file.' },

  // MEDIUM — require confirmation only in subagent context
  { id: 'shell:git-push', level: 'medium', tool: 'shell', pattern: 'git push*' },
  { id: 'shell:git-commit', level: 'medium', tool: 'shell', pattern: 'git commit*' },
  { id: 'write:config-package', level: 'medium', tool: 'write_file', pattern: '*package.json' },
  { id: 'write:config-tsconfig', level: 'medium', tool: 'write_file', pattern: '*tsconfig*' },
  { id: 'write:config-dockerfile', level: 'medium', tool: 'write_file', pattern: '*Dockerfile*' },
  { id: 'write:burst', level: 'medium', tool: 'write_file', condition: 'multi_edit_burst' },
  { id: 'patch:burst', level: 'medium', tool: 'patch_file', condition: 'multi_edit_burst' },
  { id: 'edit:burst', level: 'medium', tool: 'edit_file', condition: 'multi_edit_burst' },
]

// ── Helpers ──────────────────────────────────────────────────────────────────

function getToolContent(toolName: string, args: Record<string, unknown>): string | undefined {
  switch (toolName) {
    case 'shell':
      if (typeof args.command !== 'string') return undefined
      // Normalize: trim and collapse multiple spaces
      return args.command.trim().replace(/\s+/g, ' ')
    case 'write_file':
    case 'edit_file':
    case 'patch_file':
      return typeof args.path === 'string' ? args.path : undefined
    case 'git':
      return typeof args.action === 'string' ? `${args.action}${args.force === true ? ' --force' : ''}` : undefined
    default:
      return undefined
  }
}

// ── Main Assessment ──────────────────────────────────────────────────────────

export function assessRisk(
  toolName: string,
  args: Record<string, unknown>,
  context: RiskContext,
): RiskAssessment | null {
  const { config } = context

  const optionalRiskEnabled = config.enabled !== false

  const largeThreshold = config.thresholds?.largeFileLines ?? 100
  const burstThreshold = config.thresholds?.burstCount ?? 3

  // Merge: user rules override defaults by id
  const userRulesById = new Map((config.rules ?? []).map(r => [r.id, r]))
  const mergedRules = DEFAULT_RISK_RULES.map(rule => {
    const override = userRulesById.get(rule.id)
    if (!override) return rule
    if (rule.level !== 'high') return { ...rule, ...override }
    return { ...override, ...rule, description: override.description ?? rule.description, enabled: true }
  })
  // Append user rules with new ids
  for (const r of config.rules ?? []) {
    if (!DEFAULT_RISK_RULES.some(d => d.id === r.id)) mergedRules.push(r)
  }

  // Sort by specificity (longer pattern first), then by level (high before medium)
  const sorted = mergedRules.filter(rule => rule.enabled !== false && (optionalRiskEnabled || rule.level === 'high')).sort((a, b) => {
    const lenA = a.pattern?.length ?? 0
    const lenB = b.pattern?.length ?? 0
    if (lenA !== lenB) return lenB - lenA  // longer pattern = more specific = first
    // Same length: high before medium
    return a.level === 'high' ? -1 : 1
  })

  // Typing into a third-party page transmits that text to the site: always a fresh confirmation.
  if (toolName === 'browser' && browserActionKind(args) === 'type') {
    const origin = originOf(browserTarget(args))
    if (origin && !isLoopbackOrigin(origin)) {
      const uploads = args.action === 'upload' || args.action === 'batch' && Array.isArray(args.steps)
        && args.steps.some(step => step && typeof step === 'object' && (step as Record<string, unknown>).action === 'upload')
      return { level: 'high', matchedRule: 'browser:transmit', description: `${uploads ? 'Uploading sends file contents' : 'Typing sends this text'} to ${origin}.`, requiresConfirmation: true }
    }
  }

  // A dev server is a project-defined command run on the host, outside the shell sandbox and with network.
  if (toolName === 'dev_server' && args.action === 'start') {
    return { level: 'high', matchedRule: 'dev_server:host', description: 'Runs a project command on this machine, outside the sandbox, with network access.', requiresConfirmation: true }
  }

  const content = getToolContent(toolName, args)
  const networkCapability = hasNetworkCapability(toolName, args)

  let assessment: RiskAssessment | null = null
  for (const rule of sorted) {
    if (rule.tool && rule.tool !== toolName) continue

    let matched = false

    if (rule.pattern) {
      if (content === undefined) continue
      matched = globMatch(rule.pattern, content)
    } else if (rule.condition === 'large_overwrite') {
      // The Agent supplies this from the validated filesystem path; tool-call arguments are not trusted.
      if (typeof args._existingLineCount !== 'number') continue
      matched = args._existingLineCount >= largeThreshold
    } else if (rule.condition === 'multi_edit_burst') {
      matched = context.recentWriteCount >= burstThreshold
    } else if (!rule.pattern && !rule.condition) {
      // Rule with only tool match — matches any use of that tool
      matched = true
    }

    if (!matched) continue

    const requiresConfirmation = rule.level === 'high' ? true : context.isSubAgent

    assessment = {
      level: rule.level,
      matchedRule: rule.id,
      description: rule.description ?? `Matched risk rule: ${rule.id}`,
      requiresConfirmation,
    }
    break
  }

  // Network is a mandatory high-risk capability. Preserve a more specific
  // destructive high-risk rule, but upgrade low/medium network operations.
  if (toolName === 'shell' && typeof args.command === 'string' && (hasPackageInstallCapability(args.command) || hasDirectPackageInstallInvocation(args.command))) {
    if (assessment?.level === 'high') return { ...assessment, description: `${assessment.description} ${PACKAGE_LIFECYCLE_WARNING}` }
    return { level: 'high', matchedRule: 'shell:package-install', description: PACKAGE_LIFECYCLE_WARNING, requiresConfirmation: true }
  }
  if (toolName === 'shell' && typeof args.command === 'string' && hasPackageLifecycleScriptExecution(args.command)) {
    if (assessment?.level === 'high') return { ...assessment, description: `${assessment.description} ${PACKAGE_REBUILD_WARNING}` }
    return { level: 'high', matchedRule: 'shell:package-lifecycle', description: PACKAGE_REBUILD_WARNING, requiresConfirmation: true }
  }
  if (toolName === 'shell' && typeof args.command === 'string' && hasPackageScriptExecution(args.command)) {
    if (assessment?.level === 'high') return { ...assessment, description: `${assessment.description} ${PACKAGE_SCRIPT_WARNING}` }
    return { level: 'high', matchedRule: 'shell:package-script', description: PACKAGE_SCRIPT_WARNING, requiresConfirmation: true }
  }
  if (toolName === 'shell' && typeof args.command === 'string' && hasCloudMutation(args.command)) {
    const implicitTarget = hasImplicitCloudMutationTarget(args.command)
    const warning = implicitTarget ? CLOUD_TARGET_WARNING : CLOUD_EXPLICIT_TARGET_WARNING
    if (assessment?.level === 'high') return { ...assessment, description: `${assessment.description} ${warning}` }
    return {
      level: 'high',
      matchedRule: implicitTarget ? 'shell:cloud-target-implicit' : 'shell:network',
      description: implicitTarget ? warning : `Network capability requires explicit approval. ${warning}`,
      requiresConfirmation: true,
    }
  }
  if (networkCapability && assessment?.level !== 'high') {
    return {
      level: 'high',
      matchedRule: 'shell:network',
      description: 'Network capability requires explicit approval.',
      requiresConfirmation: true,
    }
  }
  return assessment
}
