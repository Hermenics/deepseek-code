import { expect, test } from 'bun:test'
import React from 'react'
import { PassThrough } from 'node:stream'
import { renderSync } from '../../../src/ink/root.js'
import { AskUserQuestionsPrompt } from '../../../src/ui/questions/AskUserQuestions.js'

class FakeTerminal extends PassThrough {
  isTTY = true
  isRaw = false
  columns = 100
  rows = 24
  setRawMode(enabled: boolean): this { this.isRaw = enabled; return this }
  ref(): this { return this }
  unref(): this { return this }
}

function renderPrompt(questions: React.ComponentProps<typeof AskUserQuestionsPrompt>['questions'], onSubmit: (answers: Record<string, string>) => void) {
  const stdin = new FakeTerminal()
  const stdout = new FakeTerminal()
  const instance = renderSync(
    <AskUserQuestionsPrompt questions={questions} onSubmit={onSubmit} onCancel={() => {}} />,
    {
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout: stdout as unknown as NodeJS.WriteStream,
      stderr: stdout as unknown as NodeJS.WriteStream,
      exitOnCtrlC: false,
      patchConsole: false,
    },
  )
  return { stdin, stdout, instance }
}

async function press(stdin: FakeTerminal, input: string) {
  stdin.write(input)
  await Bun.sleep(40)
}

function cleanup(prompt: ReturnType<typeof renderPrompt>) {
  prompt.stdout.isTTY = false
  prompt.instance.unmount()
  prompt.instance.cleanup()
}

test('renders choice questions and returns the selected answer', async () => {
  let result: Record<string, string> | undefined
  const prompt = renderPrompt([{
    header: 'Runtime', question: 'Which runtime?', type: 'choice',
    options: [
      { label: 'Bun', description: 'Fast.' },
      { label: 'Node', description: 'Compatible.' },
    ],
  }], answers => { result = answers })
  let rendered = ''
  prompt.stdout.on('data', chunk => { rendered += chunk.toString() })

  try {
    await Bun.sleep(80)
    await press(prompt.stdin, '\x1b[B')
    await press(prompt.stdin, '\r')
    expect(result).toEqual({ '0': 'Node' })
    const plain = rendered.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\s/g, '')
    expect(plain).toContain('Whichruntime?')
    expect(plain).toContain('☐Runtime')
    expect(plain).toContain('3.Other')
  } finally {
    cleanup(prompt)
  }
})

test('selects a choice with its number shortcut', async () => {
  let result: Record<string, string> | undefined
  const prompt = renderPrompt([{
    header: 'Confirm', question: 'Continue?', type: 'yesno',
  }], answers => { result = answers })
  let rendered = ''
  prompt.stdout.on('data', chunk => { rendered += chunk.toString() })

  try {
    await Bun.sleep(80)
    expect(rendered.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')).not.toContain('Other')
    await press(prompt.stdin, '2')
    expect(result).toEqual({ '0': 'No' })
  } finally {
    cleanup(prompt)
  }
})

test('opens the custom answer with its number shortcut', async () => {
  let result: Record<string, string> | undefined
  const prompt = renderPrompt([{
    header: 'Choice', question: 'Pick one?', type: 'choice',
    options: [{ label: 'A', description: 'First.' }, { label: 'B', description: 'Second.' }],
  }], answers => { result = answers })

  try {
    await Bun.sleep(80)
    await press(prompt.stdin, '3')
    for (const character of 'custom') await press(prompt.stdin, character)
    await press(prompt.stdin, '\r')
    expect(result).toEqual({ '0': 'custom' })
  } finally {
    cleanup(prompt)
  }
})

test('accepts free-form text and advances through multiple questions', async () => {
  let result: Record<string, string> | undefined
  const prompt = renderPrompt([
    { header: 'Name', question: 'What is the project name?', type: 'text' },
    {
      header: 'Mode', question: 'Which mode?', type: 'choice',
      options: [
        { label: 'Safe', description: 'Read-only.' },
        { label: 'Fast', description: 'More automation.' },
      ],
    },
  ], answers => { result = answers })

  try {
    await Bun.sleep(80)
    for (const character of 'demo') await press(prompt.stdin, character)
    await press(prompt.stdin, '\r')
    await press(prompt.stdin, '\r')
    expect(result).toEqual({ '0': 'demo', '1': 'Safe' })
  } finally {
    cleanup(prompt)
  }
})

test('supports selecting multiple options before submitting', async () => {
  let result: Record<string, string> | undefined
  const prompt = renderPrompt([{
    header: 'Features', question: 'Which features?', type: 'choice', multiSelect: true,
    options: [
      { label: 'Search, files', description: 'Find files.' },
      { label: 'Preview', description: 'Inspect changes.' },
    ],
  }], answers => { result = answers })

  try {
    await Bun.sleep(80)
    await press(prompt.stdin, ' ')
    await press(prompt.stdin, '\x1b[B')
    await press(prompt.stdin, ' ')
    await press(prompt.stdin, '\r')
    expect(result).toEqual({ '0': '["Search, files","Preview"]' })
  } finally {
    cleanup(prompt)
  }
})

test('serializes a custom multi-select answer as a JSON array string', async () => {
  let result: Record<string, string> | undefined
  const prompt = renderPrompt([{
    header: 'Features', question: 'Which features?', type: 'choice', multiSelect: true,
    options: [
      { label: 'Search', description: 'Find files.' },
      { label: 'Preview', description: 'Inspect changes.' },
    ],
  }], answers => { result = answers })

  try {
    await Bun.sleep(80)
    await press(prompt.stdin, ' ')
    await press(prompt.stdin, '\x1b[B')
    await press(prompt.stdin, '\x1b[B')
    await press(prompt.stdin, '\r')
    for (const character of 'custom, filter') await press(prompt.stdin, character)
    await press(prompt.stdin, '\r')
    await press(prompt.stdin, '\r')
    expect(result).toEqual({ '0': '["Search","custom, filter"]' })
  } finally {
    cleanup(prompt)
  }
})
