import { useClock } from '../../clock.js'
import Box from '../../../ink/components/Box.js'
import Text from '../../../ink/components/Text.js'

const SPINNER = ['✻', '✼', '✽', '✾', '✿', '❀', '✿', '✾', '✽', '✽', '✼']

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
  'Asking the rubber duck...',
  'Reticulating splines...',
  'Centering the div...',
  'Questioning life choices...',
  'Hoping the tests pass...',
]

/** Puns per tool, shown only while that tool is in flight. */
const TOOL_MSGS: Record<string, string[]> = {
  read_file: ['Reading between the lines...', 'Speed-reading someone else\'s code...', 'Pretending to read every line...'],
  write_file: ['Writing more problems...', 'Committing fresh bugs to disk...', 'Typing with unearned confidence...'],
  patch_file: ['Editing out the evidence...', 'Patching what I just broke...', 'Moving a semicolon, surgically...'],
  read_folder: ['Snooping through folders...', 'Judging your file structure...', 'Counting untitled-final files...'],
  shell: ['Running commands with no undo...', 'Sacrificing a shell to the gods...', 'Typing sudo and hoping...'],
  grep: ['Grepping for hope...', 'Looking for the needle...', 'Regexing my way out of this...'],
  glob: ['Globbing everything in sight...', 'Casting a wide wildcard net...', 'Star-dot-starring around...'],
  web_fetch: ['Downloading the internet...', 'Asking the web politely...', 'Fetching, like a good dog...'],
  subagent: ['Delegating my problems...', 'Cloning myself for backup...', 'Assembling the swarm...'],
  git: ['Running git blame on you...', 'Rewriting history, carefully...', 'Negotiating with the index...'],
  todo: ['Making a list, checking it twice...', 'Adding tasks I will regret...', 'Turning chaos into checkboxes...'],
  introspect: ['Looking inward...', 'Reading my own source...', 'Having a small identity crisis...'],
  update_knowledge: ['Taking notes for future me...', 'Memorizing this, probably...', 'Filing it under "later"...'],
}

/**
 * Deterministic message pick — no Math.random (CodeQL js/insecure-randomness).
 * `activeTool` wins while a tool call is streaming or executing, so the pun
 * matches what the agent is actually doing.
 */
export function pickLoadingMessage(
  phase: string,
  toolCallCount: number,
  activeTool?: string | null,
): string {
  if (phase === 'refining') return REFINING_MSGS[toolCallCount % REFINING_MSGS.length]!
  const toolMsgs = activeTool ? TOOL_MSGS[activeTool] : undefined
  if (toolMsgs) return toolMsgs[toolCallCount % toolMsgs.length]!
  return LOADING_MSGS[toolCallCount % LOADING_MSGS.length]!
}

interface LoadingSpinnerProps {
  toolCallCount: number
  phase: 'idle' | 'thinking' | 'refining' | 'tool_calling' | 'executing'
  /** Tool currently in flight, if any — drives the tool-specific pun. */
  activeTool?: string | null
}

export function LoadingSpinner({ toolCallCount, phase, activeTool }: LoadingSpinnerProps) {
  const tick = useClock()
  const isRefining = phase === 'refining'
  const msg = pickLoadingMessage(phase, toolCallCount, activeTool)

  return (
    <Box flexDirection="row" gap={1} paddingLeft={1}>
      <Text color={isRefining ? 'magenta' : 'cyan'}>{SPINNER[tick % SPINNER.length]}</Text>
      <Text color="#888888">{msg}</Text>
      <Text color="#888888">{' ·  Ctrl+C to cancel'}</Text>
    </Box>
  )
}
