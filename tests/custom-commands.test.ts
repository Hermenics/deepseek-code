import { describe, expect, it, afterEach } from 'bun:test'
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
})
