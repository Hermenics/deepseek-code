# Task: streaming-fix

## Context
The agent uses OpenAI SDK streaming (`stream: true`) with `for await` over chunks.
`onToken` is called per `delta.content` chunk. `onToolCall`/`onToolResult` fire during tool execution.
The UI buffers tokens in a 50ms `setInterval` flush loop.

Reports indicate that neither text streaming nor tool streaming is working — tokens arrive
but may not be flushed, or `delta.content` may be null/empty for certain providers
(e.g. success.ai custom base URL).

## Scope
- `src/agent/agent.ts` — `runLoop()` streaming logic
- `src/ui/App.tsx` — `runAgent()` flush interval + callbacks
- `tests/streaming.test.ts` — NEW test file (TDD Red phase first)

## Acceptance Criteria
- [ ] `onToken` is called for every non-empty `delta.content` chunk
- [ ] `onToken` is NOT called when `delta.content` is null, undefined or empty string
- [ ] `onToolCall` fires before tool execution with correct name and args
- [ ] `onToolResult` fires after tool execution with correct name and result
- [ ] Streaming works even when `delta.content` arrives as empty string (provider quirk)
- [ ] Streaming works when chunks arrive with `choices: []` (usage-only chunks)
- [ ] Token accumulation in `tokenBuffer` is flushed correctly on `onDone`
- [ ] No tokens are lost between `onToolCall` and the next streaming segment

## Test Scenarios
- [ ] Happy path: stream with 3 text chunks → onToken called 3 times
- [ ] Edge case: chunk with `delta.content = ''` → onToken NOT called
- [ ] Edge case: chunk with `delta.content = null` → onToken NOT called
- [ ] Edge case: chunk with `choices: []` (usage chunk) → no crash, no onToken
- [ ] Tool call: onToolCall fires with correct name/args before execution
- [ ] Tool result: onToolResult fires with correct result after execution
- [ ] Mixed: text chunk → tool call → text chunk → all callbacks fire in order
- [ ] Abort mid-stream: partial text is preserved, onDone is called

## References
- Task file: .claude/agents/ceo/task-streaming-fix.md
- src/agent/agent.ts (runLoop, lines ~407-566)
- src/ui/App.tsx (runAgent, lines ~205-300)
- tests/agent.test.ts (existing agent tests for reference)
