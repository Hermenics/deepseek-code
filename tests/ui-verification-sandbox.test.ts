import { expect, it } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { detectVerificationCommand } from '../src/agent/verify.js'
import { runProjectVerificationReadOnly } from '../src/tools/Shell/Shell.js'
import { sandboxAvailable } from '../src/utils/platform.js'

const sandboxTest = it.skipIf(!sandboxAvailable())

sandboxTest('UI verification cannot pass a test that mutates, asserts, and restores a project input', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deepseek-ui-verification-'))
  const target = join(root, 'verification-target.ts')
  const original = 'export const value = "original";\n'
  try {
    await writeFile(join(root, 'package.json'), JSON.stringify({ scripts: { test: 'bun test' } }))
    await writeFile(join(root, 'bun.lock'), '')
    await writeFile(target, original)
    await writeFile(join(root, 'contract.test.ts'), `import { expect, it } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
it('temporary files remain writable', () => {
  const path = '/tmp/deepseek-ui-verification-' + process.pid;
  writeFileSync(path, 'writable');
  expect(readFileSync(path, 'utf8')).toBe('writable');
  console.log('temporary file writable');
});
it('cannot mutate and restore project inputs during verification', () => {
  const original = readFileSync('verification-target.ts', 'utf8');
  let mutated = false;
  let observed = '';
  try {
    writeFileSync('verification-target.ts', 'export const value = "mutated";\\n');
    mutated = true;
    observed = readFileSync('verification-target.ts', 'utf8');
  } finally {
    if (mutated) writeFileSync('verification-target.ts', original);
  }
  expect(observed).toContain('mutated');
});
`)

    const command = await detectVerificationCommand(root)
    expect(command).not.toBeNull()
    const result = await runProjectVerificationReadOnly(command!, root)

    expect(result.executionEnvironment).toBe('linux-bwrap')
    expect(result.ok).toBe(false)
    expect(result.status).not.toBe('passed')
    expect(result.output).toContain('EROFS')
    expect(result.output).toContain('temporary file writable')
    expect(await readFile(target, 'utf8')).toBe(original)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
