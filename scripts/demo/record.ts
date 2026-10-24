import { spawn } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_IGNORE_LINES } from '../../src/tools/shared/deepseekignore.js'
import { DEMO_PROMPT, UPDATED_SOURCE, UPDATED_TESTS } from './scenario.js'
import { startMockProvider } from './mockProvider.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const work = await mkdtemp(join(process.env.RUNNER_TEMP ?? tmpdir(), 'deepseek-demo-'))
const workspace = join(work, 'workspace')
const home = join(work, 'home')
const mp4 = join(root, 'website/public/demo.mp4')
const gif = join(root, 'src/public/demo.gif')
const mp4Output = join(work, 'demo.mp4')
const rawMp4Output = join(work, 'demo-raw.mp4')
const gifOutput = join(work, 'demo.gif')
const tapePath = join(work, 'record.tape')

async function command(name: string, args: string[], env = process.env): Promise<void> {
  await new Promise<void>((resolveCommand, reject) => {
    const child = spawn(name, args, { cwd: root, env, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', code => code === 0 ? resolveCommand() : reject(new Error(`${name} ${args.join(' ')} exited with ${code}`)))
  })
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function tapeText(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
}

function probe(path: string): Promise<{ width: number; height: number; codec: string }> {
  return new Promise((resolveProbe, reject) => {
    const child = spawn('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,codec_name', '-of', 'json', path], { cwd: root, stdio: ['ignore', 'pipe', 'inherit'] })
    let output = ''
    child.stdout.setEncoding('utf8').on('data', chunk => { output += chunk })
    child.once('error', reject)
    child.once('exit', code => {
      if (code !== 0) return reject(new Error(`ffprobe failed for ${path}`))
      const stream = (JSON.parse(output) as { streams?: Array<{ width?: number; height?: number; codec_name?: string }> }).streams?.[0]
      if (!stream?.width || !stream.height || !stream.codec_name) return reject(new Error(`No video stream found in ${path}`))
      resolveProbe({ width: stream.width, height: stream.height, codec: stream.codec_name })
    })
  })
}

try {
  await cp(join(root, 'scripts/demo/workspace'), workspace, { recursive: true })
  await writeFile(join(workspace, '.deepseekignore'), `${DEFAULT_IGNORE_LINES.join('\n')}\n`)
  await mkdir(join(home, '.deepseek'), { recursive: true })
  await writeFile(join(home, '.deepseek', 'settings.json'), JSON.stringify({
    provider: { name: 'deepseek' },
    model: { default: 'deepseek-flash' },
    interaction: { defaultMode: 'build' },
    permissions: { allow: ['ReadFile', 'WriteFile', 'Shell(bun test)'] },
  }, null, 2) + '\n')
  await writeFile(join(home, '.deepseek', 'config.json'), JSON.stringify({ PROVIDER: 'deepseek', DEEPSEEK_API_KEY: 'demo-only-key' }) + '\n')

  const mock = startMockProvider(workspace)
  const commandLine = `cd ${shellQuote(workspace)} && clear && exec env CI= TERM=xterm-256color COLORTERM=truecolor FORCE_COLOR=3 DEEPSEEK_FULLSCREEN=1 DEEPSEEK_DISABLE_ALTERNATE_SCREEN=0 DEEPSEEK_SCREEN_READER=0 ${shellQuote(join(root, 'dist/deepseek.mjs'))}`
  const tape = (await readFile(join(root, 'scripts/demo/record.tape'), 'utf8'))
    .replace('$DEMO_MP4', tapeText(rawMp4Output))
    .replace('$DEMO_COMMAND', tapeText(commandLine))
    .replace('$DEMO_PROMPT', tapeText(DEMO_PROMPT))
  await writeFile(tapePath, tape)
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    FORCE_COLOR: '3',
    DEEPSEEK_FULLSCREEN: '1',
    DEEPSEEK_API_KEY: 'demo-only-key',
    DEEPSEEK_BASE_URL: mock.baseURL,
  }
  delete env.CI
  delete env.NO_COLOR
  delete env.DEEPSEEK_DISABLE_ALTERNATE_SCREEN
  delete env.DEEPSEEK_SCREEN_READER

  await command('vhs', [tapePath], env).finally(() => mock.close())

  if (mock.state.failure) throw new Error(mock.state.failure)
  if (!mock.state.finished || mock.state.requests !== 6) throw new Error(`Expected six deterministic model turns; received ${mock.state.requests}.`)
  if (await readFile(join(workspace, 'src/signup.js'), 'utf8') !== UPDATED_SOURCE) throw new Error('The real CLI did not write the expected signup validation.')
  if (await readFile(join(workspace, 'tests/signup.test.js'), 'utf8') !== UPDATED_TESTS) throw new Error('The real CLI did not write the expected test cases.')

  await command('ffmpeg', ['-y', '-v', 'error', '-i', rawMp4Output, '-vf', 'scale=1920:1080:force_original_aspect_ratio=decrease:flags=lanczos,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0x080a10,setsar=1', '-r', '30', '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-pix_fmt', 'yuv420p', mp4Output])
  const mp4Probe = await probe(mp4Output)
  if (mp4Probe.width !== 1920 || mp4Probe.height !== 1080 || mp4Probe.codec !== 'h264') throw new Error(`Unexpected MP4 video stream: ${JSON.stringify(mp4Probe)}`)
  await command('ffmpeg', ['-v', 'error', '-i', mp4Output, '-f', 'null', '-'])

  const palette = join(work, 'palette.png')
  await command('ffmpeg', ['-y', '-v', 'error', '-i', mp4Output, '-vf', 'fps=12,scale=960:-1:flags=lanczos,palettegen=stats_mode=diff', '-frames:v', '1', palette])
  await command('ffmpeg', ['-y', '-v', 'error', '-i', mp4Output, '-i', palette, '-filter_complex', 'fps=12,scale=960:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle', '-loop', '0', gifOutput])
  const gifProbe = await probe(gifOutput)
  if (gifProbe.width !== 960 || gifProbe.height !== 540 || gifProbe.codec !== 'gif') throw new Error(`Unexpected GIF stream: ${JSON.stringify(gifProbe)}`)

  const mp4Staged = `${mp4}.${process.pid}.tmp`
  const gifStaged = `${gif}.${process.pid}.tmp`
  try {
    await cp(mp4Output, mp4Staged)
    await cp(gifOutput, gifStaged)
    await rename(mp4Staged, mp4)
    await rename(gifStaged, gif)
  } finally {
    await Promise.all([rm(mp4Staged, { force: true }), rm(gifStaged, { force: true })])
  }

  console.log(`Demo recording verified: ${mp4Probe.width}x${mp4Probe.height} H.264 and ${gifProbe.width}x${gifProbe.height} GIF.`)
} finally {
  await rm(work, { recursive: true, force: true })
}
