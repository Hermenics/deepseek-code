export type AskUserQuestionType = 'choice' | 'text' | 'yesno'

export interface AskUserQuestionOption {
  label: string
  description: string
}

export interface AskUserQuestion {
  question: string
  header: string
  type?: AskUserQuestionType
  options?: AskUserQuestionOption[]
  multiSelect?: boolean
  placeholder?: string
}

/** Answers remain strings; multi-select values are JSON-encoded string arrays. */
export type AskUserAnswers = Record<string, string>

export type AskUserHandler = (
  questions: AskUserQuestion[],
  signal?: AbortSignal,
) => Promise<AskUserAnswers | null>
