import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { loadAgentRegistry } from '../src/agent/config.js'

const temporary: string[] = []
async function project(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), 'deepseek-agents-'))
  temporary.push(cwd)
  await mkdir(join(cwd, '.deepseek', 'agents'), { recursive: true })
  return cwd
}
afterEach(async () => { await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true }))) })

describe('agent registry inheritance', () => {
  it('resolves same-layer bases regardless of file enumeration order', async () => {
    const cwd = await project()
    const directory = join(cwd, '.deepseek', 'agents')
    await writeFile(join(directory, 'a-child.json'), JSON.stringify({ name: 'order-child', extends: 'order-base', description: 'child' }))
    await writeFile(join(directory, 'z-base.json'), JSON.stringify({ name: 'order-base', systemPrompt: 'base prompt', usage: 'subagent' }))

    const child = (await loadAgentRegistry(cwd)).find(agent => agent.config.name === 'order-child')
    expect(child?.config.systemPrompt).toBe('base prompt')
    expect(child?.config.usage).toBe('subagent')
    expect(child?.config.description).toBe('child')
  })

  it('rejects missing bases and inheritance cycles', async () => {
    const missing = await project()
    await writeFile(join(missing, '.deepseek', 'agents', 'missing.json'), JSON.stringify({ name: 'missing-child', extends: 'no-such-agent' }))
    await expect(loadAgentRegistry(missing)).rejects.toThrow('extends missing agent')

    const cyclic = await project()
    const directory = join(cyclic, '.deepseek', 'agents')
    await writeFile(join(directory, 'a.json'), JSON.stringify({ name: 'cycle-a', extends: 'cycle-b' }))
    await writeFile(join(directory, 'b.json'), JSON.stringify({ name: 'cycle-b', extends: 'cycle-a' }))
    await expect(loadAgentRegistry(cyclic)).rejects.toThrow('inheritance cycle')
  })
})
