import { describe, expect, it, afterEach, spyOn } from 'bun:test'
import * as fs from 'node:fs/promises'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { discoverCustomCommands, resolveCustomCommand } from '../src/commands/custom.js'
import { resolveCommand } from '../src/commands/index.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

describe('custom commands', () => {
  it('discovers project markdown commands and expands arguments', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'deepseek-custom-'))
    temporaryDirectories.push(directory)
    await mkdir(join(directory, '.git'))
    await mkdir(join(directory, '.deepseek', 'commands'), { recursive: true })
    await writeFile(join(directory, '.deepseek', 'commands', 'review.md'), '---\ndescription: Review a file\n---\nReview $1 with these extra details: $ARGUMENTS')

    const commands = await discoverCustomCommands(directory)
    expect(commands.map(command => command.name)).toContain('review')
    const result = await resolveCustomCommand('/review app.ts carefully', directory)
    expect(result).toEqual({
      type: 'custom',
      name: 'review',
      prompt: 'Review app.ts with these extra details: app.ts carefully',
    })
  })

  it('ignores malformed and oversized command files', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'deepseek-custom-'))
    temporaryDirectories.push(directory)
    await mkdir(join(directory, '.git'))
    const commandsDirectory = join(directory, '.deepseek', 'commands')
    await mkdir(commandsDirectory, { recursive: true })
    await writeFile(join(commandsDirectory, 'bad_name.md'), 'prompt')
    await writeFile(join(commandsDirectory, 'empty.md'), '---\ndescription: empty\n---\n')
    await writeFile(join(commandsDirectory, 'large.md'), 'x'.repeat(128 * 1024 + 1))

    expect(await discoverCustomCommands(directory)).toEqual([])
  })

  it('keeps built-in precedence when a custom command collides', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'deepseek-custom-'))
    temporaryDirectories.push(directory)
    await mkdir(join(directory, '.git'))
    await mkdir(join(directory, '.deepseek', 'commands'), { recursive: true })
    await writeFile(join(directory, '.deepseek', 'commands', 'review.md'), 'custom review prompt')

    expect(await resolveCommand('/review app.ts', directory)).toEqual({ type: 'review', target: 'app.ts' })
  })

  it('continues discovering commands when a plugin root disappears', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'deepseek-custom-'))
    temporaryDirectories.push(directory)
    const pluginsDir = join(directory, 'plugins')
    const old = process.env.DEEPSEEK_PLUGINS_DIR
    process.env.DEEPSEEK_PLUGINS_DIR = pluginsDir
    try {
      await mkdir(join(directory, '.deepseek', 'commands'), { recursive: true })
      await writeFile(join(directory, '.deepseek', 'commands', 'local.md'), 'Local command')
      for (const name of ['missing', 'working']) {
        await mkdir(join(pluginsDir, name, 'commands'), { recursive: true })
        await writeFile(join(pluginsDir, name, 'plugin.json'), JSON.stringify({ name }))
        await writeFile(join(pluginsDir, name, 'commands', 'audit.md'), 'Audit command')
      }
      await writeFile(join(pluginsDir, 'registry.json'), JSON.stringify({ version: 1, plugins: { missing: { name: 'missing' }, working: { name: 'working' } } }))
      const realpath = fs.realpath
      const spy = spyOn(fs, 'realpath').mockImplementation(((path: Parameters<typeof realpath>[0]) => {
        if (path === join(pluginsDir, 'missing')) return Promise.reject(new Error('plugin removed'))
        return realpath(path)
      }) as typeof realpath)
      try {
        expect((await discoverCustomCommands(directory)).map(command => command.name)).toEqual(expect.arrayContaining(['local', 'working-audit']))
        expect(spy).toHaveBeenCalledWith(join(pluginsDir, 'missing'))
      } finally { spy.mockRestore() }
    } finally {
      if (old === undefined) delete process.env.DEEPSEEK_PLUGINS_DIR
      else process.env.DEEPSEEK_PLUGINS_DIR = old
    }
  })

  it('resolves installed plugin commands under a plugin-qualified name', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'deepseek-custom-'))
    temporaryDirectories.push(directory)
    const pluginsDir = join(directory, 'plugins')
    const old = process.env.DEEPSEEK_PLUGINS_DIR
    process.env.DEEPSEEK_PLUGINS_DIR = pluginsDir
    try {
      await mkdir(join(pluginsDir, 'review-pack', 'commands'), { recursive: true })
      await writeFile(join(pluginsDir, 'review-pack', 'plugin.json'), '{"name":"review-pack"}')
      await writeFile(join(pluginsDir, 'review-pack', 'commands', 'audit.md'), 'Audit $1 carefully.')
      await writeFile(join(pluginsDir, 'registry.json'), JSON.stringify({ version: 1, plugins: { 'review-pack': { name: 'review-pack' } } }))
      expect(await resolveCommand('/review-pack-audit src', directory)).toEqual({ type: 'custom', name: 'review-pack-audit', prompt: 'Audit src carefully.' })
      await writeFile(join(pluginsDir, 'review-pack', 'plugin.json'), '{"name":"review-pack","commands":{"invalid":"type"}}')
      expect(await resolveCustomCommand('/review-pack-audit src', directory)).toBeNull()
    } finally {
      if (old === undefined) delete process.env.DEEPSEEK_PLUGINS_DIR
      else process.env.DEEPSEEK_PLUGINS_DIR = old
    }
  })
})
