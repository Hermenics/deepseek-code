/**
 * The spending level moves several cost knobs at once. Two properties make
 * it safe to hand to someone who does not know what those knobs are:
 *
 *   - it can only take away spending, never correctness;
 *   - it loses to anything the user wrote down themselves.
 */
import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import * as os from 'os'
import { DEFAULT_SETTINGS, loadSettingsSnapshot, validateSettings } from '../src/settings/repository.js'
import {
  BUDGET_LEVELS,
  BUDGET_PROFILES,
  budgetProfile,
  DEFAULT_BUDGET_LEVEL,
  isBudgetLevel,
  moaPanelSize,
  verifierAllowed,
  verifierForced,
} from '../src/settings/budget.js'

const temporary: string[] = []
async function scratch(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'deepseek-budget-'))
  temporary.push(path)
  return path
}
afterEach(async () => {
  await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

/** A project whose settings.json holds `data`, resolved against an empty home. */
async function snapshotWith(data: Record<string, unknown>) {
  const cwd = await scratch()
  const fakeHome = await scratch()
  await mkdir(join(cwd, '.deepseek'), { recursive: true })
  await writeFile(join(cwd, '.deepseek', 'settings.json'), JSON.stringify(data))
  const homedirSpy = spyOn(os, 'homedir').mockReturnValue(fakeHome)
  try {
    return await loadSettingsSnapshot(cwd)
  } finally {
    homedirSpy.mockRestore()
  }
}

describe('budget profiles', () => {
  it('describes every level in the user\'s own terms', () => {
    for (const level of BUDGET_LEVELS) {
      const profile = BUDGET_PROFILES[level]
      expect(profile.label.length).toBeGreaterThan(0)
      expect(profile.tagline.length).toBeGreaterThan(0)
    }
  })

  it('leaves the build alone at the middle level', () => {
    // This is the upgrade-safety property. Someone who never opens this
    // setting is on the middle level, and must get exactly the behaviour
    // they had before it existed.
    expect(BUDGET_PROFILES.comfortable.settings).toEqual({})
  })

  it('matches the pre-existing behaviour on every lever, not only settings', () => {
    // Three of the levers do not live in the settings tree, so an empty
    // overlay is not by itself proof that nothing changed. Each value here
    // is what the code did before the level existed: effort was a hardcoded
    // 'high', the verifier ran exactly when shouldVerify said so, and the
    // MoA panel was whatever the caller configured.
    const middle = BUDGET_PROFILES.comfortable
    expect(middle.effort).toBe('high')
    expect(verifierAllowed('comfortable')).toBe(true)
    expect(verifierForced('comfortable')).toBe(false)
    expect(moaPanelSize('comfortable', 7)).toBe(7)
  })

  it('caps nothing at the top level either', () => {
    expect(BUDGET_PROFILES.loaded.settings).toEqual({})
  })

  it('only the cheapest level touches the cost knobs', () => {
    const broke = BUDGET_PROFILES.broke.settings
    expect(broke.agents!.concurrency!).toBeLessThan(5)
    expect(broke.agents!.maxCostUsd!).toBeGreaterThan(0)
    // A lower compaction threshold means the context is trimmed sooner, so
    // every later turn carries fewer tokens.
    expect(broke.compaction!.threshold!).toBeLessThan(0.9)
  })

  it('turns thinking off only at the cheapest level', () => {
    expect(BUDGET_PROFILES.broke.effort).toBe('low')
    expect(BUDGET_PROFILES.comfortable.effort).toBe('high')
    expect(BUDGET_PROFILES.loaded.effort).toBe('max')
  })

  it('falls back to a level that is neither the cheapest nor the loudest', () => {
    expect(budgetProfile(undefined)).toBe(BUDGET_PROFILES[DEFAULT_BUDGET_LEVEL])
    expect(DEFAULT_BUDGET_LEVEL).toBe('comfortable')
  })

  it('recognises only the levels it defines', () => {
    expect(isBudgetLevel('broke')).toBe(true)
    expect(isBudgetLevel('rich')).toBe(false)
    expect(isBudgetLevel(undefined)).toBe(false)
  })
})

describe('what the level is allowed to switch off', () => {
  it('stops paying a second model to review, but only that', () => {
    // The mechanical checks are not routed through this decision at all —
    // they are git and a shell command, and they run at every level.
    expect(verifierAllowed('broke')).toBe(false)
    expect(verifierAllowed('comfortable')).toBe(true)
    expect(verifierAllowed('loaded')).toBe(true)
  })

  it('reviews everything, not only the risky results, at the top level', () => {
    // Without this, the top two levels would be indistinguishable here and
    // "always" would be a word that bought nothing.
    expect(verifierForced('loaded')).toBe(true)
    expect(verifierForced('comfortable')).toBe(false)
    expect(verifierForced('broke')).toBe(false)
  })

  it('refuses the mixture-of-agents panel rather than quietly shrinking it', () => {
    // Answering with one model under a name that promises several is the
    // kind of quiet substitution this whole feature is supposed to avoid.
    expect(moaPanelSize('broke', 4)).toBe(0)
    expect(moaPanelSize('comfortable', 4)).toBe(4)
    expect(moaPanelSize('loaded', 4)).toBe(4)
  })
})

describe('budget resolution', () => {
  it('applies the profile when nothing else is configured', async () => {
    const snapshot = await snapshotWith({ budget: 'broke' })
    expect(snapshot.effective.agents?.concurrency).toBe(2)
    expect(snapshot.effective.compaction?.threshold).toBe(0.7)
  })

  it('changes nothing for someone who never picks a level', async () => {
    // Compared against the shipped defaults, not against another snapshot.
    // The default level *is* the middle one, so two snapshots would both
    // carry the same overlay and the comparison could never fail however
    // much that overlay grew — a test that agrees with itself.
    //
    // Whole-tree rather than field by field, because the middle level is
    // what someone gets without asking, and anything it touches is a
    // change applied on an upgrade in a setting they never opened.
    const baseline = {
      ...DEFAULT_SETTINGS,
      // The resolver always materialises these three; nothing to do with
      // the budget, and spelled out rather than excluded so that a real
      // permissions change would still be caught here.
      permissions: { ...DEFAULT_SETTINGS.permissions, allow: [], deny: [], suppress: [] },
    }
    const middle = await snapshotWith({ budget: 'comfortable' })
    expect(middle.effective).toEqual(baseline)
  })

  it('loses to a value the user wrote down', async () => {
    // This is the whole safety property: picking a mood must not silently
    // discard a limit someone chose on purpose.
    const snapshot = await snapshotWith({ budget: 'broke', agents: { concurrency: 8 } })
    expect(snapshot.effective.agents?.concurrency).toBe(8)
    // Knobs the user did not touch still follow the level.
    expect(snapshot.effective.compaction?.threshold).toBe(0.7)
  })

  it('overrides the shipped defaults, which are not a user decision', async () => {
    const shipped = await snapshotWith({})
    expect(shipped.effective.agents?.concurrency).toBe(5)
    const broke = await snapshotWith({ budget: 'broke' })
    expect(broke.effective.agents?.concurrency).toBe(2)
  })

  it('leaves everything alone at the top level', async () => {
    const snapshot = await snapshotWith({ budget: 'loaded' })
    expect(snapshot.effective.agents?.maxCostUsd).toBeUndefined()
    expect(snapshot.effective.compaction?.threshold).toBe(0.9)
  })

  it('reports a misspelled level instead of ignoring it', () => {
    const issues = validateSettings({ budget: 'rich' } as never)
    expect(issues.some(issue => issue.path === 'budget')).toBe(true)
    expect(validateSettings({ budget: 'broke' })).toEqual([])
  })
})

describe('thinking depth follows the level', () => {
  it('moves effort with the level', async () => {
    const { Agent } = await import('../src/agent/agent.js')
    const agent = new Agent({ provider: 'deepseek', apiKey: 'test-key' })

    await agent.applySettings({ budget: 'broke' })
    expect(agent.effortLevel).toBe('low')

    await agent.applySettings({ budget: 'loaded' })
    expect(agent.effortLevel).toBe('max')

    await agent.applySettings({ budget: 'comfortable' })
    expect(agent.effortLevel).toBe('high')
  })

  it('keeps the effort guidance the startup prompt is built around', async () => {
    // The level sets two things: API parameters and a paragraph in the
    // system prompt. Applying it before the prompt and the seed messages
    // exist loses the paragraph — the request still says do not think,
    // while the text telling the model why is gone.
    const { Agent } = await import('../src/agent/agent.js')
    const cwd = await scratch()
    await mkdir(join(cwd, '.deepseek'), { recursive: true })
    await writeFile(join(cwd, '.deepseek', 'settings.json'), JSON.stringify({ budget: 'broke' }))

    const agent = new Agent({ provider: 'deepseek', apiKey: 'test-key' }, { projectRoot: cwd })
    await agent.readyPromise

    expect(agent.effortLevel).toBe('low')
    const seeded = (agent as unknown as { messages: { content: unknown }[] }).messages
    expect(String(seeded[0]?.content ?? '')).toContain('# EFFORT LEVEL')
  })

  it('never overrules an effort the user chose out loud', async () => {
    const { Agent } = await import('../src/agent/agent.js')
    const agent = new Agent({ provider: 'deepseek', apiKey: 'test-key' })

    // `/effort max` is a decision about this session. A spending level
    // describes a wallet, and must not quietly undo it.
    agent.setEffortLevel('max')
    await agent.applySettings({ budget: 'broke' })
    expect(agent.effortLevel).toBe('max')
  })

  it('is not undone by the settings load the constructor started', async () => {
    const { Agent } = await import('../src/agent/agent.js')
    const agent = new Agent({ provider: 'deepseek', apiKey: 'test-key' })

    // Applied immediately, while construction is still reading from disk.
    // Before applySettings waited for that load, the later arrival put the
    // project's own level back and the caller's choice vanished.
    await agent.applySettings({ budget: 'broke' })
    await agent.readyPromise
    expect(agent.effortLevel).toBe('low')
  })
})
