import OpenAI from 'openai'

const REFINER_SYSTEM = `You are an expert Prompt Engineer for AI coding agents. Transform the user's raw request into a highly optimized prompt for a coding agent.

The refined prompt must:
1. Define the agent's role clearly (e.g. "You are a senior TypeScript engineer working on X")
2. State the objective precisely and unambiguously
3. Break the task into numbered sub-goals
4. List which files/directories the agent should read first for context (if inferable)
5. Specify success criteria (what "done" looks like)
6. If the request is ambiguous or complex, instruct the agent to ask 2-3 targeted clarifying questions BEFORE starting work
7. End with: "Think step by step. Plan before you act."

Return ONLY the refined prompt. No preamble, no explanation, no markdown wrapper.`

/**
 * Refines a raw user message into an optimized prompt for the coding agent.
 * Falls back to the original message silently on any error.
 */
export async function refinePrompt(
  client: OpenAI,
  model: string,
  userMessage: string,
): Promise<string> {
  // Short messages (commands, quick questions) don't need refinement
  if (userMessage.length < 30 || userMessage.startsWith('/')) {
    return userMessage
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
    return response.choices[0]?.message.content?.trim() || userMessage
  } catch {
    return userMessage
  }
}
