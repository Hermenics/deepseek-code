import { describe, it, expect, mock } from 'bun:test'
import { refinePrompt } from '../src/agent/promptRefiner.js'

function makeClient(content: string) {
  return {
    chat: {
      completions: {
        create: mock(() =>
          Promise.resolve({ choices: [{ message: { content } }] })
        ),
      },
    },
  } as any
}

describe('refinePrompt', () => {
  it('mensagem com menos de 30 chars retorna original sem chamar API', async () => {
    const client = makeClient('refinado')
    const result = await refinePrompt(client, 'deepseek-chat', 'curto')
    expect(result).toBe('curto')
    expect(client.chat.completions.create).not.toHaveBeenCalled()
  })

  it('mensagem começando com / retorna original sem chamar API', async () => {
    const client = makeClient('refinado')
    const result = await refinePrompt(client, 'deepseek-chat', '/help')
    expect(result).toBe('/help')
    expect(client.chat.completions.create).not.toHaveBeenCalled()
  })

  it('API retornando SKIP retorna mensagem original', async () => {
    const msg = 'Implemente uma função que some dois números inteiros'
    const client = makeClient('SKIP')
    const result = await refinePrompt(client, 'deepseek-chat', msg)
    expect(result).toBe(msg)
  })

  it('API retornando prompt refinado retorna o refinado', async () => {
    const msg = 'Implemente uma função que some dois números inteiros'
    const refined = 'Você é um engenheiro TypeScript sênior. Implemente...'
    const client = makeClient(refined)
    const result = await refinePrompt(client, 'deepseek-chat', msg)
    expect(result).toBe(refined)
  })

  it('API lançando exceção retorna mensagem original (fallback silencioso)', async () => {
    const msg = 'Implemente uma função que some dois números inteiros'
    const client = {
      chat: {
        completions: {
          create: mock(() => Promise.reject(new Error('API error'))),
        },
      },
    } as any
    const result = await refinePrompt(client, 'deepseek-chat', msg)
    expect(result).toBe(msg)
  })

  it('mensagem com exatamente 30 chars chama a API', async () => {
    const msg = 'a'.repeat(30) // 30 chars, não < 30
    const client = makeClient('SKIP')
    await refinePrompt(client, 'deepseek-chat', msg)
    expect(client.chat.completions.create).toHaveBeenCalledTimes(1)
  })

  it('mensagem com 29 chars não chama a API', async () => {
    const msg = 'a'.repeat(29)
    const client = makeClient('refinado')
    const result = await refinePrompt(client, 'deepseek-chat', msg)
    expect(result).toBe(msg)
    expect(client.chat.completions.create).not.toHaveBeenCalled()
  })
})
