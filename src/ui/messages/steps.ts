import type { Message } from '../App.js'

/** Swaps every open step's present-tense label for its past-tense one. */
export function closeSteps(messages: Message[]): Message[] {
  if (!messages.some((message) => message.role === 'step' && message.doneLabel)) return messages
  return messages.map((message) => message.role === 'step' && message.doneLabel
    ? { role: 'step', content: message.doneLabel }
    : message)
}

/** Marks every open step as cut short: it keeps its present-tense label and never claims to be done. */
export function interruptSteps(messages: Message[]): Message[] {
  if (!messages.some((message) => message.role === 'step' && message.doneLabel)) return messages
  return messages.map((message) => message.role === 'step' && message.doneLabel
    ? { role: 'step', content: message.content, interrupted: true }
    : message)
}

/** Closes the running step and appends a new open one; a trailing ellipsis from the model is dropped because the heading animates its own. */
export function openStep(messages: Message[], step: { active: string; done: string }): Message[] {
  const active = step.active.replace(/\s*(?:\.+|…)$/, '') || step.active
  return [...closeSteps(messages), { role: 'step', content: active, doneLabel: step.done }]
}

/** For each message, whether it is a tool call inside a step opened earlier in the same turn; one pass over the transcript. */
export function stepToolFlags(messages: Message[]): boolean[] {
  let inStep = false
  return messages.map((message) => {
    if (message.role === 'user') inStep = false
    else if (message.role === 'step') inStep = true
    return inStep && message.role === 'tool'
  })
}
