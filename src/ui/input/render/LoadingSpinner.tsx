import { useEffect, useState } from 'react'
import { useClock } from '../../clock.js'

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

interface LoadingSpinnerProps {
  toolCallCount: number
  phase: 'idle' | 'thinking' | 'refining' | 'tool_calling'
}

export function LoadingSpinner({ toolCallCount, phase }: LoadingSpinnerProps) {
  const tick = useClock()
  const [msgIdx, setMsgIdx] = useState(() => Math.floor(Math.random() * LOADING_MSGS.length))
  const [refineIdx] = useState(() => Math.floor(Math.random() * REFINING_MSGS.length))

  useEffect(() => {
    setMsgIdx(Math.floor(Math.random() * LOADING_MSGS.length))
  }, [toolCallCount])

  const isRefining = phase === 'refining'
  const msg = isRefining ? REFINING_MSGS[refineIdx % REFINING_MSGS.length] : LOADING_MSGS[msgIdx]

  return (
    <box flexDirection="row" gap={1} paddingLeft={1}>
      <text fg={isRefining ? 'magenta' : 'cyan'}>{SPINNER[tick % SPINNER.length]}</text>
      <text fg="#888888">{msg}</text>
      <text fg="#888888">{' ·  Ctrl+C to cancel'}</text>
    </box>
  )
}
