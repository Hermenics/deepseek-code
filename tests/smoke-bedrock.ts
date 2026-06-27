/**
 * Smoke test real com AWS Bedrock — requer .env.test.bedrock
 * Uso: bun run --env-file .env.test.bedrock tests/smoke-bedrock.ts
 */
import { createLLMClient } from '../src/agent/llmClient.js'

const region = process.env.AWS_REGION ?? 'us-east-1'

async function smokeTest(model: string, label: string) {
  console.log(`\n🔥 [${label}] model: ${model}`)

  const client = createLLMClient({ provider: 'bedrock', awsRegion: region }, model)

  const start = Date.now()
  const res = await client.chat.completions.create({
    model,
    messages: [{ role: 'user', content: 'Responda apenas: OK' }],
    max_tokens: 512,
    stream: false,
  } as any)

  const elapsed = Date.now() - start
  const msg = res.choices[0]?.message
  const content = msg?.content ?? (msg as any)?.reasoning_content ?? '(vazio)'
  console.log(`✅ Resposta (${elapsed}ms): ${content}`)
  if (!content || content === '(vazio)') {
    console.log('🔍 Raw response:', JSON.stringify(res, null, 2))
  }
}

async function smokeToolsR1() {
  const model = 'us.deepseek.r1-v1:0'
  console.log(`\n🔥 [Bedrock R1 Tools via Prompt Emulation] model: ${model}`)

  const client = createLLMClient({ provider: 'bedrock', awsRegion: region }, model)

  // Simula o system prompt com tool embutida (igual ao buildBedrockToolsPrompt)
  const systemPrompt = `You have access to the following tools. To use a tool, respond with a <tool_call> block:

<tool_call>
<name>tool_name</name>
<args>{"param": "value"}</args>
</tool_call>

After the tool runs, you will receive a <tool_result> block. When you have the final answer, respond normally without a <tool_call> block.

Available tools:
<tool name="get_weather">
  <description>Returns the current weather for a city</description>
  <parameters>
    - city (string): The city name
  </parameters>
  <required>city</required>
</tool>`

  const start = Date.now()
  const res = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: 'What is the weather in São Paulo?' },
    ],
    max_tokens: 512,
    stream: false,
  } as any)

  const elapsed = Date.now() - start
  const msg = res.choices[0]?.message
  const raw = msg?.content ?? (msg as any)?.reasoning_content ?? ''

  // Parse tool_call XML
  const toolCallMatch = /<tool_call>([\s\S]*?)<\/tool_call>/.exec(raw)
  if (toolCallMatch) {
    const nameMatch = /<name>([\s\S]*?)<\/name>/.exec(toolCallMatch[1]!)
    const argsMatch = /<args>([\s\S]*?)<\/args>/.exec(toolCallMatch[1]!)
    const name = nameMatch?.[1]?.trim() ?? '?'
    const args = argsMatch?.[1]?.trim() ?? '{}'
    console.log(`✅ Tool call detectada (${elapsed}ms): ${name}(${args})`)
  } else {
    console.log(`⚠️  Sem tool_call no response (${elapsed}ms). Raw:\n${raw}`)
  }
}

// DeepSeek R1 via InvokeModel (inference profile)
await smokeTest('us.deepseek.r1-v1:0', 'Bedrock R1 InvokeModel')

// DeepSeek V3.2 via bedrock-mantle Chat Completions
await smokeTest('deepseek.v3.2', 'Bedrock V3.2 Mantle')

// R1 com tool emulation via prompt
await smokeToolsR1()

console.log('\n🚀 Smoke test concluído!')
