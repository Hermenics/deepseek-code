import type { Tool } from '../types.js'
import type { AskUserQuestion, AskUserAnswers } from './types.js'

const questionSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    question: { type: 'string', minLength: 1 },
    header: { type: 'string', minLength: 1, maxLength: 30 },
    type: { type: 'string', enum: ['choice', 'text', 'yesno'] },
    options: {
      type: 'array',
      minItems: 2,
      maxItems: 4,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          label: { type: 'string', minLength: 1 },
          description: { type: 'string' },
        },
        required: ['label', 'description'],
      },
    },
    multiSelect: { type: 'boolean' },
    placeholder: { type: 'string' },
  },
  required: ['question', 'header'],
}

export const AskUserQuestions: Tool = {
  name: 'ask_user_questions',
  description: 'Ask the user one or more questions to clarify requirements, preferences, or decisions. Prefer concise choice options; use text for free-form input and yesno for confirmation.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      questions: {
        type: 'array',
        minItems: 1,
        maxItems: 4,
        items: questionSchema,
        description: 'One to four questions to present together.',
      },
    },
    required: ['questions'],
  },
  async execute(args, context) {
    if (!Array.isArray(args.questions)) return 'Error: questions must be an array.'
    if (args.questions.length < 1 || args.questions.length > 4) {
      return 'Error: questions must contain between 1 and 4 entries.'
    }
    const questions = args.questions as AskUserQuestion[]
    for (const [index, question] of questions.entries()) {
      if (!question || typeof question !== 'object') return `Error: question ${index + 1} must be an object.`
      const type = question.type ?? 'choice'
      if (type === 'choice' && (!question.options || question.options.length < 2 || question.options.length > 4)) {
        return `Error: question ${index + 1} of type choice requires 2-4 options.`
      }
    }
    if (!context?.askUser) return 'Error: ask_user_questions is unavailable outside the interactive main session.'

    const answers = await context.askUser(questions, context.signal)
    if (answers === null) return JSON.stringify({ cancelled: true, answers: {} })

    const result: { answers: AskUserAnswers; cancelled: false } = { answers, cancelled: false }
    return JSON.stringify(result)
  },
}
