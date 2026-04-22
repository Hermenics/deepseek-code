import { useState, useEffect, useRef } from 'react'
import { Box, Text } from 'ink'
import { COMMAND_SUGGESTIONS } from '../../commands.js'
import { useClock } from '../clock.js'
import { loadInputHistory } from '../../agent/inputHistory.js'
import type { AgentPhase } from '../App.js'
import { MODE_LABELS, MODE_COLORS, type InteractionMode } from '../interactionMode.js'

const DESCRIPTIONS: Record<string, string> = {
  '/quit': 'Exit DeepSeek Code',
  '/q': 'Exit DeepSeek Code',
  '/clear': 'Clear chat history',
  '/compact': 'Summarize history to save context',
  '/help': 'Show available commands',
  '/agent': 'Load a custom agent',
  '/agents': 'List available agents',
  '/model deepseek-chat': 'Switch to DeepSeek-V3 (fast, general purpose)',
  '/model deepseek-reasoner': 'Switch to DeepSeek-R1 (chain-of-thought reasoning)',
  '/models': 'Switch model interactively',
  '/language': 'Change preferred language',
  '/theme': 'Change color theme',
  '/undo': 'Restore last file modified by agent',
  '/retry': 'Re-run last message',
  '/cost': 'Show estimated session cost',
  '/files': 'List files modified this session',
  '/tools': 'List all available tools (built-in + MCP)',
  '/system': 'Show active system prompt',
  '/sessions': 'List recent sessions',
  '/checkpoint': 'Save current state',
  '/checkpoint list': 'List saved checkpoints',
  '/plan': 'Plan implementation of a task',
  '/review': 'Review code in the project',
}

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

const REFINING_MSGS = [
  'Prompt-engineering your prompt...',
  'Distilling the essence of the problem...',
  'Translating human to AI...',
  'Calibrating artificial neurons...',
  'Applying elite prompt engineering...',
  'Atomizing the problem...',
  'Scalpel-sharpening your question...',
  'Untangling chaos into clarity...',
  'Pre-thinking the thinking...',
  'Consulting the engineering oracle...',
  'Reverse-engineering your intent...',
  'Assembling the perfect prompt...',
]

const LOADING_MSGS = [
  'Consulting the code gods...',
  'Pretending to understand the problem...',
  'Zigzagging through Stack Overflow...',
  'Compiling excuses...',
  'Training artificial neurons...',
  'Reading the docs (not really)...',
  'Calculating the wrong answer...',
  'Sipping virtual coffee...',
  'Debugging the universe...',
  'Definitely not asking ChatGPT...',
  'Inventing an elegant solution...',
  'Praying for no segfault...',
  'Ignoring the warnings...',
  'Running git blame on you...',
  'Simulating intelligence...',
  'Toothbrushing the bits...',
  'Convincing the pointer not to dereference null...',
  'Waiting for the garbage collector...',
  'Fine-combing the JSON...',
  'Stringifying the world...',
  'Teaching the loop to loop...',
  'Polishing the parentheses...',
  'Side-eyeing the any type...',
  'Sending the callback to therapy...',
  'Committing without a message...',
  'Deploying to the cloud (literally)...',
  'Removing coffee from the variable...',
  'Compiling patience...',
  'Serializing the chaos...',
  'Parsing the meaning of life...',
  'Fleeing the merge conflict...',
  'Rebasing reality...',
  'Merging consciousness...',
  'console.logging the void...',
  'Philosophizing with Google...',
  'Negotiating with the compiler...',
  'Asking the rubber duck...',
  'Blaming the intern...',
  'Reticulating splines...',
  'Untangling callback hell...',
  'Yak shaving...',
  'Bikeshedding the architecture...',
  'Counting semicolons...',
  'Escaping the escape characters...',
  'Resolving promise rejections...',
  'Awaiting the awaited await...',
  'Closing unclosed tags...',
  'Centering the div...',
  'Fighting CSS specificity...',
  'Questioning life choices...',
  'Googling the error message...',
  'Copying from the top Stack Overflow answer...',
  'Deleting node_modules and reinstalling...',
  'Turning it off and on again...',
  'Checking if it works in production...',
  'Hoping the tests pass...',
  'Writing tests after the fact...',
  'Commenting out the broken code...',
  'Adding TODO: fix this later...',
  'Pushing directly to main...',
  'Reverting the revert of the revert...',
  'Cherry-picking the wrong commit...',
  'Force-pushing and hoping for the best...',
  'Squashing bugs into bigger bugs...',
  'Refactoring the refactor...',
  'Abstracting the abstraction...',
  'Over-engineering a simple solution...',
  'Under-engineering a complex problem...',
  'Bikeshedding the variable name...',
  'Arguing about tabs vs spaces...',
  'Debating semicolons...',
  'Choosing a JavaScript framework...',
  'Migrating to the new JavaScript framework...',
  'Migrating away from the new JavaScript framework...',
  'Rewriting it in Rust...',
  'Rewriting it in Go...',
  'Rewriting it in TypeScript...',
  'Rewriting it in whatever is trendy...',
  'Adding blockchain to it...',
  'Making it AI-powered...',
  'Containerizing the container...',
  'Orchestrating the orchestrator...',
  'Microservicing the monolith...',
  'Monolithing the microservices...',
  'Scaling to zero users...',
  'Optimizing for the wrong bottleneck...',
  'Premature optimization in progress...',
  'Measuring twice, cutting once, measuring again...',
  'Estimating 2 weeks (it will take 6)...',
  'Declaring sprint velocity...',
  'Attending the standup about the standup...',
  'Writing the ticket for the ticket...',
  'Closing the ticket as "works as designed"...',
  'Reopening the closed ticket...',
  'Marking it as "cannot reproduce"...',
  'Blaming the network...',
  'Blaming the database...',
  'Blaming the user...',
  'Blaming the requirements...',
  'Blaming the previous developer...',
  'Blaming yourself (correctly)...',
  'Checking if it works on my machine...',
  'Shipping the "it works on my machine" certificate...',
  'Dockerizing the problem away...',
  'Kubernetes-ing the Kubernetes...',
  'Terraforming the infrastructure...',
  'Ansible-ing the Ansible...',
  'CI/CD-ing the CI/CD...',
  'Monitoring the monitoring...',
  'Alerting on the alert...',
  'Paging the on-call engineer at 3am...',
  'Rolling back the rollback...',
  'Hotfixing the hotfix...',
  'Patching the patch...',
  'Versioning the version...',
  'Deprecating the deprecated...',
  'Migrating the migration...',
  'Seeding the seed...',
  'Indexing the index...',
  'Querying the query...',
  'Joining the join...',
  'N+1-ing the N+1...',
  'Caching the cache miss...',
  'Invalidating the cache (everything breaks)...',
  'Rate limiting the rate limiter...',
  'Retrying the retry...',
  'Timing out the timeout...',
  'Deadlocking the deadlock...',
  'Race conditioning the race condition...',
  'Memory leaking the memory leak...',
  'Stack overflowing the stack...',
  'Heap dumping the heap...',
  'Core dumping the core...',
  'Segfaulting gracefully...',
  'Null pointer exceptioning...',
  'Undefined behavioring...',
  'NaN-ing the number...',
  'Infinity-ing the loop...',
  'Off-by-one-ing the array...',
  'Integer overflowing the integer...',
  'Floating point erroring the float...',
  'Bit flipping the bit...',
  'Endian-swapping the endian...',
  'UTF-8 encoding the emoji...',
  'Regex-ing the regex (now you have two problems)...',
  'Parsing HTML with regex (three problems)...',
  'XSS-ing the XSS prevention...',
  'SQL-injecting the SQL injection prevention...',
  'CSRF-ing the CSRF token...',
  'Hashing the hash...',
  'Salting the salt...',
  'Encrypting the encryption key...',
  'Storing passwords in plaintext (just kidding)...',
  'Committing secrets to git (not kidding)...',
  'Rotating the rotated credentials...',
  'Expiring the expired token...',
  'Refreshing the refresh token...',
  'OAuth-ing the OAuth...',
  'JWT-ing the JWT...',
  'CORS-ing the CORS...',
  'Proxying the proxy...',
  'Load balancing the load balancer...',
  'CDN-ing the CDN...',
  'DNS-ing the DNS (it\'s always DNS)...',
  'Pinging the ping...',
  'Tracerouting the traceroute...',
  'Firewalling the firewall...',
  'VPN-ing the VPN...',
  'SSH-ing into the wrong server...',
  'sudo rm -rf-ing (just kidding)...',
  'chmod 777-ing everything...',
  'chown root:root-ing...',
  'cron-jobbing the cron job...',
  'systemd-ing the systemd...',
  'grep-ing through 10GB of logs...',
  'tail -f-ing the log file...',
  'awk-ing the awk...',
  'sed-ing the sed...',
  'piping the pipe...',
  'redirecting stdout to /dev/null...',
  'cat-ing the cat...',
  'ls -la-ing the directory...',
  'cd ..-ing out of trouble...',
  'vim-ing and not knowing how to exit...',
  'nano-ing like a coward...',
  'Making it work, then making it right, then making it fast...',
  'Shipping it and praying...',
]

export function LoadingSpinner({ toolCallCount, phase }: { toolCallCount: number; phase: AgentPhase }) {
  const tick = useClock()
  const [msgIdx, setMsgIdx] = useState(() => Math.floor(Math.random() * LOADING_MSGS.length))
  const [refineIdx] = useState(() => Math.floor(Math.random() * REFINING_MSGS.length))

  useEffect(() => {
    setMsgIdx(Math.floor(Math.random() * LOADING_MSGS.length))
  }, [toolCallCount])

  const isRefining = phase === 'refining'
  const msg = isRefining ? REFINING_MSGS[refineIdx % REFINING_MSGS.length] : LOADING_MSGS[msgIdx]

  return (
    <Box gap={1} paddingLeft={1}>
      <Text color={isRefining ? 'magenta' : 'cyan'}>{SPINNER[tick % SPINNER.length]}</Text>
      <Text dimColor>{msg}</Text>
      <Text dimColor> ·  Ctrl+C to cancel</Text>
    </Box>
  )
}

export function getMatches(value: string): string[] {
  if (!value.startsWith('/')) return []
  return COMMAND_SUGGESTIONS.filter((s) => s.startsWith(value) && s !== value)
}

interface KeyInfo {
  name?: string
  sequence: string
  ctrl: boolean
  meta: boolean
  shift: boolean
}

export function parseKey(sequence: string): KeyInfo {
  const ctrl = sequence.charCodeAt(0) === 0x1b
  const meta = sequence.includes('\x1b')
  const shift = false

  if (sequence === '\x1b[A') return { name: 'up', sequence, ctrl, meta, shift }
  if (sequence === '\x1b[B') return { name: 'down', sequence, ctrl, meta, shift }
  if (sequence === '\x1b[C') return { name: 'right', sequence, ctrl, meta, shift }
  if (sequence === '\x1b[D') return { name: 'left', sequence, ctrl, meta, shift }
  if (sequence === '\x1b[H') return { name: 'home', sequence, ctrl, meta, shift }
  if (sequence === '\x1b[F') return { name: 'end', sequence, ctrl, meta, shift }
  if (sequence === '\x1b[3~') return { name: 'delete', sequence, ctrl, meta, shift }
  if (sequence === '\x7f') return { name: 'backspace', sequence, ctrl: false, meta: false, shift: false }
  if (sequence === '\r' || sequence === '\n') return { name: 'return', sequence, ctrl, meta, shift }
  if (sequence === '\x1b') return { name: 'escape', sequence, ctrl, meta, shift }
  if (sequence === '\t') return { name: 'tab', sequence, ctrl, meta, shift }

  return { name: undefined, sequence, ctrl, meta, shift }
}

export function handleEnterPress(opts: {
  value: string
  isLoading: boolean
  onSubmit: (text: string) => void
  onQueue?: (text: string) => void
}): { clearInput: boolean } {
  const trimmed = opts.value.trim()
  if (!trimmed) return { clearInput: false }

  if (opts.isLoading) {
    opts.onQueue?.(trimmed)
    return { clearInput: true }
  }

  opts.onSubmit(trimmed)
  return { clearInput: true }
}

export function InputBox({
  onSubmit,
  isLoading,
  toolCallCount,
  onAbort,
  onQueue,
  phase = 'idle',
  contextPct = 0,
  agentLabel = 'deepseek',
  interactionMode = 'chat',
  onModeChange,
}: {
  onSubmit: (text: string) => void
  isLoading: boolean
  toolCallCount: number
  onAbort?: () => void
  onQueue?: (text: string) => void
  phase?: AgentPhase
  contextPct?: number  // 0–100
  agentLabel?: string
  interactionMode?: InteractionMode
  onModeChange?: () => void
}) {
  const [value, setValue] = useState('')
  const [cursorPos, setCursorPos] = useState(0)
  const [pastedBlock, setPastedBlock] = useState<string | null>(null)
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [ctrlCAt, setCtrlCAt] = useState<number | null>(null)

  // Input history state
  const [inputHistory, setInputHistory] = useState<string[]>([])
  const [historyIdx, setHistoryIdx] = useState<number>(-1)
  const [savedDraft, setSavedDraft] = useState('')

  // Load history on mount
  useEffect(() => {
    loadInputHistory().then(setInputHistory)
  }, [])

  // Clear the "press again to exit" hint after 2s
  useEffect(() => {
    if (ctrlCAt === null) return
    const t = setTimeout(() => setCtrlCAt(null), 2000)
    return () => clearTimeout(t)
  }, [ctrlCAt])

  const matches = getMatches(value)
  const showDropdown = matches.length > 0

  // Keep a ref that always reflects the latest state/props so the stdin
  // listener (registered once) never closes over stale values.
  const stateRef = useRef({
    isLoading, onAbort, onSubmit, onQueue, onModeChange,
    value, cursorPos, pastedBlock,
    showDropdown, matches, selectedIdx,
    inputHistory, historyIdx, savedDraft, ctrlCAt,
  })
  useEffect(() => {
    stateRef.current = {
      isLoading, onAbort, onSubmit, onQueue, onModeChange,
      value, cursorPos, pastedBlock,
      showDropdown, matches, selectedIdx,
      inputHistory, historyIdx, savedDraft, ctrlCAt,
    }
  })

  // Register the stdin listener exactly once — reads live state via stateRef.
  useEffect(() => {
    const stdin = process.stdin
    if (typeof stdin.setRawMode !== 'function') return

    stdin.setRawMode(true)
    stdin.resume()

    const onData = (data: Buffer) => {
      const sequence = data.toString()
      const s = stateRef.current

      // Ctrl+C handling
      if (sequence === '\x03') {
        if (s.isLoading) {
          s.onAbort?.()
        } else {
          const now = Date.now()
          if (s.ctrlCAt !== null && now - s.ctrlCAt < 2000) {
            process.exit(0)
          } else {
            setCtrlCAt(now)
          }
        }
        return
      }

      // Any other key clears the "press again" hint
      if (s.ctrlCAt !== null && sequence !== '\x03') {
        setCtrlCAt(null)
      }

      // Shift+Tab: alterna o modo de interação
      if (sequence === '\x1b[Z') {
        s.onModeChange?.()
        return
      }

      // When loading, only allow Enter (to queue) — block other editing keys
      if (s.isLoading) {
        const key = parseKey(sequence)
        if (key.name === 'return') {
          const result = handleEnterPress({
            value: s.value,
            isLoading: true,
            onSubmit: s.onSubmit,
            onQueue: s.onQueue,
          })
          if (result.clearInput) {
            setValue('')
            setCursorPos(0)
            setPastedBlock(null)
          }
        }
        return
      }

      const key = parseKey(sequence)

      // ── Command autocomplete dropdown ──────────────────────────────────────
      if (s.showDropdown) {
        if (key.name === 'up') {
          setSelectedIdx((i) => (i - 1 + s.matches.length) % s.matches.length)
          return
        }
        if (key.name === 'down') {
          setSelectedIdx((i) => (i + 1) % s.matches.length)
          return
        }
        if (key.name === 'tab' || key.name === 'return') {
          const chosen = s.matches[s.selectedIdx]!
          // Both Tab and Enter always execute the selected command
          s.onSubmit(chosen)
          setValue('')
          setCursorPos(0)
          setSelectedIdx(0)
          setHistoryIdx(-1)
          return
        }
        if (key.name === 'escape') {
          setValue('')
          setCursorPos(0)
          setSelectedIdx(0)
          return
        }
      } else {
        // ── Input history navigation (↑↓ when no dropdown) ──────────────────
        if (key.name === 'up') {
          if (s.inputHistory.length === 0) return
          const newIdx = s.historyIdx === -1
            ? s.inputHistory.length - 1
            : Math.max(0, s.historyIdx - 1)
          if (s.historyIdx === -1) setSavedDraft(s.value)
          setHistoryIdx(newIdx)
          const entry = s.inputHistory[newIdx] ?? ''
          setValue(entry)
          setCursorPos(entry.length)
          return
        }
        if (key.name === 'down') {
          if (s.historyIdx === -1) return
          const newIdx = s.historyIdx + 1
          if (newIdx >= s.inputHistory.length) {
            setHistoryIdx(-1)
            setValue(s.savedDraft)
            setCursorPos(s.savedDraft.length)
          } else {
            setHistoryIdx(newIdx)
            const entry = s.inputHistory[newIdx] ?? ''
            setValue(entry)
            setCursorPos(entry.length)
          }
          return
        }

        if (key.name === 'return') {
          const full = s.pastedBlock ? `${s.pastedBlock}\n${s.value}` : s.value
          s.onSubmit(full)
          setValue('')
          setCursorPos(0)
          setPastedBlock(null)
          setHistoryIdx(-1)
          setSavedDraft('')
          return
        }
        if (key.name === 'escape') {
          setValue('')
          setCursorPos(0)
          setPastedBlock(null)
          setHistoryIdx(-1)
          setSavedDraft('')
          return
        }
      }

      // ── Cursor movement ────────────────────────────────────────────────────
      if (key.name === 'left') { setCursorPos((pos) => Math.max(0, pos - 1)); return }
      if (key.name === 'right') { setCursorPos((pos) => Math.min(s.value.length, pos + 1)); return }
      if (key.name === 'home') { setCursorPos(0); return }
      if (key.name === 'end') { setCursorPos(s.value.length); return }

      // ── Deletion ───────────────────────────────────────────────────────────
      if (key.name === 'backspace') {
        if (s.cursorPos > 0) {
          setValue((v) => v.slice(0, s.cursorPos - 1) + v.slice(s.cursorPos))
          setCursorPos((pos) => pos - 1)
          setSelectedIdx(0)
          setHistoryIdx(-1)
        } else if (s.pastedBlock) {
          setPastedBlock(null)
        }
        return
      }
      if (key.name === 'delete') {
        if (s.cursorPos < s.value.length) {
          setValue((v) => v.slice(0, s.cursorPos) + v.slice(s.cursorPos + 1))
          setSelectedIdx(0)
          setHistoryIdx(-1)
        }
        return
      }

      // ── Paste detection: sequences longer than 1 char that aren't escape codes ──
      if (sequence.length > 1 && !sequence.startsWith('\x1b')) {
        const lines = sequence.split(/\r?\n/)
        if (lines.length > 1) {
          // Multi-line paste → move to pastedBlock
          const combined = (s.pastedBlock ?? '') + sequence
          const allLines = combined.split(/\r?\n/)
          const last = allLines.pop() ?? ''
          setPastedBlock(allLines.join('\n') + '\n')
          setValue((v) => v.slice(0, s.cursorPos) + last + v.slice(s.cursorPos))
          setCursorPos((pos) => pos + last.length)
        } else {
          // Single-line paste
          setValue((v) => v.slice(0, s.cursorPos) + sequence + v.slice(s.cursorPos))
          setCursorPos((pos) => pos + sequence.length)
        }
        setSelectedIdx(0)
        setHistoryIdx(-1)
        return
      }

      // ── Regular input ──────────────────────────────────────────────────────
      if (!key.name && !key.ctrl && !key.meta && sequence.length === 1 && sequence >= ' ') {
        setValue((v) => v.slice(0, s.cursorPos) + sequence + v.slice(s.cursorPos))
        setCursorPos((pos) => pos + 1)
        setSelectedIdx(0)
        setHistoryIdx(-1)
      }
    }

    stdin.on('data', onData)
    return () => {
      stdin.removeListener('data', onData)
      // Do NOT call setRawMode(false) here — Ink manages raw mode for the
      // entire app lifecycle. Turning it off on unmount breaks useInput in
      // components like ModelSelector and LanguageInput that replace InputBox.
    }
  }, []) // ← mount/unmount only — no more stdin thrashing on every keystroke

  const cols = process.stdout.columns ?? 80
  const isLong = value.length >= cols - 7 // account for " > " prefix (3 chars) + cursor + margin

  useEffect(() => {
    if (isLoading) return
    if (typeof process.stdout.write !== 'function') return
    process.stdout.write('\x1b[?25l')
    return () => { process.stdout.write('\x1b[?25h') }
  }, [isLoading])

  const renderTextWithCursor = () => {
    if (value === '') {
      return (
        <>
          <Text color="white">█</Text>
          {!pastedBlock && <Text dimColor>What do you want me to do? ↵</Text>}
        </>
      )
    }

    if (isLong) {
      const before = value.slice(0, cursorPos)
      const at = value.slice(cursorPos, cursorPos + 1) || ' '
      const after = value.slice(cursorPos + 1)
      return <Text>{`${before}\x1b[7m${at}\x1b[27m${after}`}</Text>
    }

    const beforeCursor = value.slice(0, cursorPos)
    const atCursor = value.slice(cursorPos, cursorPos + 1)
    const afterCursor = value.slice(cursorPos + 1)

    return (
      <>
        <Text>{beforeCursor}</Text>
        <Text color="white" backgroundColor="white" inverse>{atCursor || ' '}</Text>
        <Text>{afterCursor}</Text>
      </>
    )
  }

  return (
    <Box flexDirection="column">
      {/* Top separator with agent name and mode aligned right */}
      {(() => {
        const cols = process.stdout.columns ?? 80
        const modeLabel = `[${MODE_LABELS[interactionMode]}]`
        const label = ` ${agentLabel} `
        const suffix = modeLabel + label + '────'
        const leftDashes = Math.max(0, cols - 8 - suffix.length)
        const dashes = '─'.repeat(leftDashes)
        return (
          <Box>
            <Text dimColor>{dashes}</Text>
            <Text color={MODE_COLORS[interactionMode]}>{modeLabel}</Text>
            <Text dimColor>{label}{'────'}</Text>
          </Box>
        )
      })()}

      {/* Input area — always visible */}
      {ctrlCAt !== null ? (
        <Box paddingLeft={1}>
          <Text color="yellow">Press Ctrl+C again to exit.</Text>
        </Box>
      ) : (
        <Box>
          {contextPct > 0 && (() => {
            const color = contextPct >= 90 ? 'red' : contextPct >= 70 ? 'yellow' : 'cyan'
            return <Text color={color} dimColor={contextPct < 50}>{contextPct}% </Text>
          })()}
          <Text color={value.trimStart().startsWith('!') ? 'magenta' : 'cyan'} bold>{value.trimStart().startsWith('!') ? '!' : '❯'}</Text>
          <Text> </Text>
          {pastedBlock && (
            <Box marginRight={1} paddingX={1} borderStyle="round" borderColor="gray">
              <Text dimColor>{pastedBlock.split('\n').length} lines</Text>
            </Box>
          )}
          {value.trimStart().startsWith('!') ? (
            // Show text without leading ! (already represented by the prompt)
            (() => {
              const rest = value.trimStart().slice(1)
              const restCursor = Math.max(0, cursorPos - (value.length - value.trimStart().length) - 1)
              const beforeCursor = rest.slice(0, restCursor)
              const atCursor = rest.slice(restCursor, restCursor + 1)
              const afterCursor = rest.slice(restCursor + 1)
              return (
                <>
                  <Text>{beforeCursor}</Text>
                  <Text color="white" backgroundColor="white" inverse>{atCursor || ' '}</Text>
                  <Text>{afterCursor}</Text>
                </>
              )
            })()
          ) : renderTextWithCursor()}
        </Box>
      )}

      {/* Bottom separator */}
      {(() => {
        const cols = process.stdout.columns ?? 80
        return <Text dimColor>{'─'.repeat(cols - 8)}</Text>
      })()}

      {/* Dropdown de comandos */}
      {!isLoading && ctrlCAt === null && showDropdown && (() => {
        const MAX_VISIBLE = 6
        const total = matches.length
        const termCols = process.stdout.columns ?? 80
        const CMD_WIDTH = 22
        const descMaxLen = Math.max(10, termCols - CMD_WIDTH - 2)

        const half = Math.floor(MAX_VISIBLE / 2)
        let start = Math.max(0, selectedIdx - half)
        const end = Math.min(total, start + MAX_VISIBLE)
        if (end - start < MAX_VISIBLE) start = Math.max(0, end - MAX_VISIBLE)
        const visible = matches.slice(start, end)

        return (
          <Box flexDirection="column">
            {visible.map((cmd, vi) => {
              const i = start + vi
              const isSelected = i === selectedIdx
              const desc = DESCRIPTIONS[cmd] ?? ''
              const truncDesc = desc.length > descMaxLen ? desc.slice(0, descMaxLen - 1) + '…' : desc
              return (
                <Box key={cmd}>
                  <Text dimColor>│ </Text>
                  <Box width={CMD_WIDTH}>
                    <Text bold={isSelected} color={isSelected ? 'cyan' : undefined}>{cmd}</Text>
                  </Box>
                  <Text dimColor={!isSelected} color={isSelected ? 'cyan' : undefined}>{truncDesc}</Text>
                </Box>
              )
            })}
          </Box>
        )
      })()}
    </Box>
  )
}
