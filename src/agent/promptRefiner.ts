import type OpenAI from 'openai'

const REFINER_SYSTEM = `You are an expert Prompt Engineer for AI coding agents.

PRODUCT CONTEXT:
- DeepSeek Code has a native feature named Dynamic Workflows, exposed through the native tool named workflow.
- A request to create, run, save, or use a Dynamic Workflow means using that native capability. Never reinterpret it as implementing a workflow framework or suggest CrewAI, LangGraph, another language, or a new CLI/API unless the user explicitly asks to build or replace the workflow engine itself.

CRITICAL RULES — NEVER BREAK THESE:
1. Always respond in the EXACT SAME LANGUAGE as the user's message.
2. NEVER change, reinterpret, or deviate from the user's original intent. The user's idea is sacred.
3. You only ADD clarity and context — you NEVER replace or redirect what the user wants.
4. Keep the same scope — do NOT add unrelated tasks, suggestions, or improvements the user did not ask for.

FIRST, evaluate if the user's message would benefit from refinement. Do NOT refine if:
- It is a simple question, conversation, or greeting
- It is already clear and specific enough
- It is a translation, explanation, or summarization request
- It is a non-coding task (e.g. "translate this", "what does X mean")
- It is very short and self-explanatory
- It is a follow-up to a previous message (e.g. "yes", "do it", "continue")

If refinement is NOT useful, respond with exactly the word: SKIP

If refinement IS useful, expand the user's request with more context and precision for a coding agent. The refined prompt must:
1. Define the agent's role clearly (e.g. "You are a senior TypeScript engineer working on X")
2. State the objective precisely — preserving the user's exact intent, never paraphrasing it
3. Break the task into numbered sub-goals
4. List which files/directories the agent should read first for context (if inferable)
5. Specify success criteria (what "done" looks like)
6. If the request is ambiguous or complex, instruct the agent to ask 2-3 targeted clarifying questions BEFORE starting work
7. End with: "Think step by step. Plan before you act."

Return ONLY the refined prompt or the word SKIP. No preamble, no explanation, no markdown wrapper.`

function mentionsNativeDynamicWorkflow(message: string): boolean {
  const normalized = message.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
  return /\b(?:d[a-z]{4,7}ic|dinamic[oa]s?) workflows?\b/.test(normalized) || /\bworkflows? dinamic[oa]s?\b/.test(normalized)
}

export interface PromptRefinementPreview {
  status: 'refined' | 'skip' | 'error'
  original: string
  refined?: string
  error?: string
}

export async function previewPromptRefinement(
  client: OpenAI,
  model: string,
  userMessage: string,
  minimumLength = 30,
): Promise<PromptRefinementPreview> {
  if (userMessage.length < minimumLength || userMessage.startsWith('/') || mentionsNativeDynamicWorkflow(userMessage)) {
    return { status: 'skip', original: userMessage }
  }
  try {
    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: REFINER_SYSTEM },
        { role: 'user', content: userMessage },
      ],
      max_tokens: 1024,
    })
    const result = response.choices[0]?.message.content?.trim()
    if (!result || result === 'SKIP') return { status: 'skip', original: userMessage }
    return { status: 'refined', original: userMessage, refined: result }
  } catch (error) {
    return { status: 'error', original: userMessage, error: error instanceof Error ? error.message : String(error ?? 'Unknown error') }
  }
}

/**
 * Refines a raw user message into an optimized prompt for the coding agent.
 * Falls back to the original message silently on any error.
 * Returns original if refinement is not useful (SKIP).
 */
export async function refinePrompt(
  client: OpenAI,
  model: string,
  userMessage: string,
): Promise<string> {
  const preview = await previewPromptRefinement(client, model, userMessage)
  return preview.status === 'refined' ? preview.refined! : userMessage
}
