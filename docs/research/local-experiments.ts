import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { PassThrough } from 'node:stream'

// Run with Bun from the DeepSeek Code checkout; only temporary fixtures are written.
const root = resolve(process.argv[2] ?? process.cwd())
const { truncateShellOutput } = await import(join(root, 'src/tools/Shell/Shell.ts'))
const { ReadFile } = await import(join(root, 'src/tools/ReadFile/ReadFile.ts'))
const { PatchFile } = await import(join(root, 'src/tools/PatchFile/PatchFile.ts'))
const { loadAgentsMd, loadProjectInstructions } = await import(join(root, 'src/agent/steering.ts'))
const { enhancedMicroCompact } = await import(join(root, 'src/services/compact/microCompact.ts'))
const { captureShellStreams } = await import(join(root, 'src/tools/Shell/streamCapture.ts'))
const cwd = await mkdtemp(join(tmpdir(), 'deepseek-research-fixture-'))
const context = { workspacePath: cwd, projectRoot: cwd, permissionProfile: 'coordinator-integrator', sessionId: 'research' }
const results: Array<Record<string, unknown>> = []
function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (next < 0xdc00 || next > 0xdfff) return true
      index++
    } else if (code >= 0xdc00 && code <= 0xdfff) return true
  }
  return false
}
try {
  const sentinel = 'ROOT_CAUSE_SENTINEL'
  const output = 'H'.repeat(2000) + sentinel + 'T'.repeat(2000)
  const cut = truncateShellOutput(output, 1000)
  assert(cut.includes(sentinel))
  assert(cut.includes('truncated'))
  assert([...cut].length <= 1000)
  results.push({ id: 'L1', observed: 'center sample retains the diagnostic while disclosing truncation', inputChars: output.length, outputCodePoints: [...cut].length, nominalContentCap: 1000 })

  const longFile = join(cwd, 'single-line.txt')
  await writeFile(longFile, 'x'.repeat(1000000))
  const longRead = await ReadFile.execute({ path: longFile }, context)
  assert(longRead.length <= 20000)
  assert(longRead.length < 1000000)
  assert(longRead.includes('[continue with start_byte='))
  results.push({ id: 'L2', observed: 'single-line input is bounded by the byte-range and response caps', returnedChars: longRead.length, inputBytes: 1000000 })

  await writeFile(join(cwd, 'AGENTS.md'), 'ROOT_RULE')
  await mkdir(join(cwd, 'app'))
  await writeFile(join(cwd, 'app', 'AGENTS.md'), 'CHILD_RULE')
  assert.equal(await loadAgentsMd(cwd), 'ROOT_RULE')
  assert.equal(await loadAgentsMd(join(cwd, 'app')), 'CHILD_RULE')
  const scopedRules = await loadProjectInstructions(cwd, join(cwd, 'app', 'main.ts')) as Array<{ content: string; sources: Array<{ kind: string }> }>
  assert.deepEqual(scopedRules.filter(rule => rule.sources.some(source => source.kind === 'agents-md')).map(rule => rule.content), ['ROOT_RULE', 'CHILD_RULE'])
  results.push({ id: 'L3', observed: 'target-scoped loading includes workspace and nested AGENTS.md; the compatibility helper remains cwd-local' })

  const messages = [
    { role: 'assistant', tool_calls: [{ id: 'a', type: 'function', function: { name: 'read_file', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'a', content: 'Must preserve the active constraint: ACTIVE_CONSTRAINT ' + 'x'.repeat(300) },
    { role: 'assistant', tool_calls: [{ id: 'b', type: 'function', function: { name: 'read_file', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'b', content: 'IRRELEVANT_RECENT ' + 'x'.repeat(300) },
  ]
  const compact = enhancedMicroCompact(messages, { keepLastN: 0 })
  assert(String(compact.messages[1].content).includes('ACTIVE_CONSTRAINT'))
  assert(String(compact.messages[3].content).includes('content cleared by micro-compaction'))
  results.push({ id: 'L4', observed: 'recognized natural-language constraints are retained; relevance beyond lexical cues is not inferred' })

  const first = spawnSync('/bin/sh', ['-c', 'export DEEPSEEK_RESEARCH_STATE=present'], { cwd, encoding: 'utf8' })
  const second = spawnSync('/bin/sh', ['-c', 'printf %s "${DEEPSEEK_RESEARCH_STATE-unset}"'], { cwd, encoding: 'utf8' })
  assert.equal(first.status, 0)
  assert.equal(second.stdout, 'unset')
  results.push({ id: 'L5', observed: 'export in an isolated subprocess is not available in the next subprocess; shell state is per-call' })

  const patchFile = join(cwd, 'patch.txt')
  await writeFile(patchFile, 'one\r\ntwo\r\n')
  await PatchFile.execute({ path: patchFile, old_content: 'one\ntwo', new_content: 'ONE\nTWO' }, context)
  assert.equal(await readFile(patchFile, 'utf8'), 'ONE\r\nTWO\r\n')
  await writeFile(patchFile, 'same\nsame\n')
  const ambiguous = await PatchFile.execute({ path: patchFile, old_content: 'same', new_content: 'changed' }, context)
  assert(ambiguous.includes('matches 2 times'))
  assert.equal(await readFile(patchFile, 'utf8'), 'same\nsame\n')
  results.push({ id: 'L6', observed: 'patch normalizes LF snippet to CRLF and rejects duplicate matches without a write' })

  await writeFile(patchFile, 'target=old\nassumption=v1\n')
  await readFile(patchFile, 'utf8')
  await writeFile(patchFile, 'target=old\nassumption=v2\n')
  await PatchFile.execute({ path: patchFile, old_content: 'target=old', new_content: 'target=new' }, context)
  assert.equal(await readFile(patchFile, 'utf8'), 'target=new\nassumption=v2\n')
  results.push({ id: 'L7', observed: 'unique substring patch succeeds despite changed surrounding assumption; not a demonstrated data-loss race' })

  const proc = spawnSync('/bin/sh', ['-c', 'printf "before\n"; printf "middle\n" >&2; printf "after\n"'], { encoding: 'utf8' })
  const concatenated = [proc.stdout, proc.stderr].filter(Boolean).join('\n')
  assert(concatenated.indexOf('after') < concatenated.indexOf('middle'))
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  const capturedOrder = captureShellStreams(stdout, stderr)
  stdout.write('before\n')
  stderr.write('middle\n')
  stdout.end('after\n')
  stderr.end()
  const observedOrder = await capturedOrder
  assert.equal(observedOrder.content, 'before\nmiddle\nafter\n')
  assert.equal(observedOrder.provenance.ordering, 'observed-arrival')
  results.push({ id: 'L8', observed: 'joining completed streams loses order; Shell capture retains observed-arrival order', concatenated: concatenated.trim(), captured: observedOrder.content.trim() })

  const graphemeInput = 'a'.repeat(150) + '😀' + 'b'.repeat(150)
  const graphemeCut = truncateShellOutput(graphemeInput, 60)
  assert(!hasUnpairedSurrogate(graphemeCut))
  assert(graphemeCut.includes('😀'))
  assert([...graphemeCut].length <= 60)
  results.push({ id: 'L9', observed: 'bounded Shell truncation preserves a retained emoji as one code point', inputCodePoints: [...graphemeInput].length, outputCodePoints: [...graphemeCut].length })
  console.log(JSON.stringify({ scope: 'Deterministic mechanics, no model-quality measurement', runtime: Bun.version, checked_at: new Date().toISOString().slice(0, 10), results }, null, 2))
} finally {
  await rm(cwd, { recursive: true, force: true })
}
