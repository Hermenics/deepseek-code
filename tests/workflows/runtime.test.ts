import { describe, expect, setDefaultTimeout, test } from 'bun:test'
import { executeWorkflowScript } from '../../src/workflows/runtime.js'

setDefaultTimeout(15_000)

describe('workflow runtime', () => {
  test('bounds parallel admission and preserves order across failures', async () => {
    let running = 0
    let peak = 0
    const execution = executeWorkflowScript({
      script: `export const meta = {name: 'bounded-parallel'};
        return parallel(Array.from({length: 7}, (_, i) => () => agent(String(i))), {concurrency: 2});`,
      onCall: async (_method, args) => {
        running++
        peak = Math.max(peak, running)
        await Bun.sleep(args[0] === '0' ? 30 : 5)
        running--
        if (args[0] === '2') throw new Error('item failed')
        return { value: args[0] }
      },
    })
    expect((await execution.result).value).toEqual(['0', '1', null, '3', '4', '5', '6'])
    expect(peak).toBe(2)
  })

  test('bounds whole pipeline chains without inserting a stage barrier', async () => {
    const calls: string[] = []
    const execution = executeWorkflowScript({
      script: `export const meta = {name: 'bounded-pipeline'};
        return pipeline(['a', 'b', 'c'],
          item => agent('first:' + item),
          (previous, item, index) => agent(previous + ':' + item + ':' + index),
          {concurrency: 1});`,
      onCall: async (_method, args) => { calls.push(String(args[0])); return { value: args[0] } },
    })
    expect((await execution.result).value).toEqual(['first:a:a:0', 'first:b:b:1', 'first:c:c:2'])
    expect(calls).toEqual(['first:a', 'first:a:a:0', 'first:b', 'first:b:b:1', 'first:c', 'first:c:c:2'])
  })

  test('rejects invalid concurrency before starting work', async () => {
    for (const options of ['{concurrency: 0}', '{concurrency: 17}', '{concurrency: 1.5}', '{concurrency: "2"}', '{concurrency: null}', 'null']) {
      let calls = 0
      const execution = executeWorkflowScript({
        script: `export const meta = {name: 'invalid-concurrency'};
          return parallel([() => agent('never')], ${options});`,
        onCall: async () => { calls++; return { value: 'unexpected' } },
      })
      await expect(execution.result).rejects.toThrow('parallel options')
      expect(calls).toBe(0)
    }
  })

  test('uses the runtime concurrency default and allows nested helpers without deadlock', async () => {
    let running = 0
    let peak = 0
    const execution = executeWorkflowScript({
      concurrency: 2,
      script: `export const meta = {name: 'default-concurrency'};
        const first = await parallel(Array.from({length: 6}, (_, i) => () => agent(String(i))));
        const nested = await parallel([() => parallel([() => agent('nested')], {concurrency: 1})], {concurrency: 1});
        return {first, nested};`,
      onCall: async (_method, args) => {
        running++
        peak = Math.max(peak, running)
        await Bun.sleep(5)
        running--
        return {value: args[0]}
      },
    })
    expect((await execution.result).value).toEqual({first: ['0', '1', '2', '3', '4', '5'], nested: [['nested']]})
    expect(peak).toBe(2)
  })

  test('keeps empty helpers, item bounds and pipeline failure isolation', async () => {
    const calls: string[] = []
    const execution = executeWorkflowScript({
      script: `export const meta = {name: 'bounded-edges'};
        const empty = [await parallel([], {concurrency: 1}), await pipeline([], {concurrency: 1})];
        const identity = await pipeline([1, 2]);
        const results = await pipeline(['ok', 'bad', 'last'],
          item => agent(item, {throwOnError: true}),
          (value, item) => agent('next:' + item), {concurrency: 2});
        const errors = [];
        for (const run of [() => parallel(Array(4097).fill(() => 1)), () => pipeline(Array(4097).fill(1)),
          () => pipeline([1], value => value, {concurrency: -1}), () => pipeline([1], 42, value => value)]) {
          try { await run(); } catch (error) { errors.push(error.message); }
        }
        return {empty, identity, results, errors};`,
      onCall: async (_method, args) => {
        calls.push(String(args[0]))
        return args[0] === 'bad' ? {value: null, error: 'bad item'} : {value: args[0]}
      },
    })
    expect((await execution.result).value).toEqual({
      empty: [[], []], identity: [1, 2], results: ['next:ok', null, 'next:last'],
      errors: ['parallel item limit exceeded', 'pipeline item limit exceeded',
        'pipeline options.concurrency must be an integer from 1 to 16', 'pipeline stages must be functions'],
    })
    expect(calls).not.toContain('next:bad')
  })

  test('throwOnError exposes agent failure after accounting for usage', async () => {
    const execution = executeWorkflowScript({
      script: `export const meta = {name: 'strict-agent'};
        try { await agent('required', {throwOnError: true}); }
        catch (error) { return {message: error.message, spent: budget.spent()}; }
        throw new Error('missing failure');`,
      onCall: async () => ({ value: null, error: 'provider unavailable', usage: { tokens: 8 } }),
    })
    expect((await execution.result).value).toEqual({ message: 'provider unavailable', spent: 8 })
  })

  test('runs agent, parallel and pipeline while preserving order', async () => {
    const calls: string[] = []
    const execution = executeWorkflowScript({
      script: `
        export const meta = {"name":"runtime-test"};
        phase("research");
        const parallelResults = await parallel([
          () => agent("first"),
          () => agent("second")
        ]);
        const piped = await pipeline([1, 2],
          async value => value + 1,
          async value => agent("item:" + value)
        );
        log("done");
        return { parallelResults, piped, input: args.input };
      `,
      args: { input: 7 },
      onCall: async (method, args) => {
        expect(method).toBe('agent')
        const prompt = String(args[0])
        calls.push(prompt)
        return { value: `result:${prompt}`, usage: { tokens: 2 } }
      },
    })

    const result = await execution.result
    expect(result.value).toEqual({
      parallelResults: ['result:first', 'result:second'],
      piped: ['result:item:2', 'result:item:3'],
      input: 7,
    })
    expect(result.usage.tokens).toBe(8)
    expect(calls).toEqual(['first', 'second', 'item:2', 'item:3'])
    expect(result.events.map(event => event.type)).toEqual(['phase', 'log'])
  }, 15_000)

  test('turns individual parallel and pipeline failures into null', async () => {
    const execution = executeWorkflowScript({
      script: `
        export const meta = {"name":"partial-failure"};
        const one = await parallel([() => agent("ok"), () => agent("fail")]);
        const two = await pipeline([1, 2], async value => {
          if (value === 2) throw new Error("boom");
          return value;
        });
        return { one, two };
      `,
      onCall: async (_method, args) => {
        if (args[0] === 'fail') throw new Error('agent failed')
        return { value: 'ok' }
      },
    })

    expect((await execution.result).value).toEqual({ one: ['ok', null], two: [1, null] })
  })

  test('does not expose process, require, fetch or generated code', async () => {
    const execution = executeWorkflowScript({
      script: `
        export const meta = {"name":"sandbox-test"};
        const values = [typeof process, typeof require, typeof fetch, typeof Bun, typeof __rpc, typeof __workflowBridge];
        let generated = false;
        try { Function("return 1")(); generated = true; } catch {}
        return { values, generated };
      `,
      onCall: async () => ({ value: null }),
    })

    expect((await execution.result).value).toEqual({
      values: ['undefined', 'undefined', 'undefined', 'undefined', 'undefined', 'undefined'],
      generated: false,
    })
  })

  test('does not expose the worker realm through injected values or RPC results', async () => {
    const execution = executeWorkflowScript({
      script: `
        export const meta = {"name":"constructor-escape"};
        const result = await agent("object");
        const probes = [
          () => agent.constructor("return process")(),
          () => args.constructor.constructor("return process")(),
          () => result.constructor.constructor("return process")(),
          () => globalThis.constructor.constructor("return process")()
        ];
        return probes.map(probe => { try { probe(); return true; } catch { return false; } });
      `,
      args: { input: true },
      onCall: async () => ({ value: { safe: true } }),
    })

    expect((await execution.result).value).toEqual([false, false, false, false])
  })

  test('terminates an infinite loop', async () => {
    const execution = executeWorkflowScript({
      script: 'export const meta = {"name":"timeout-test"}; while (true) {}',
      timeoutMs: 5_000,
      onCall: async () => ({ value: null }),
    })
    await expect(execution.result).rejects.toThrow('Script execution timed out')
  })
})

describe('workflow runtime — Claude Code parity', () => {
  test('passes (previousResult, originalItem, index) to every pipeline stage', async () => {
    const execution = executeWorkflowScript({
      script: `
        export const meta = {"name":"pipeline-signature"};
        return pipeline(["a", "b"],
          (value, item, index) => value.toUpperCase() + index,
          (previous, item, index) => ({ previous, item, index }));
      `,
      onCall: async () => ({ value: null }),
    })
    expect((await execution.result).value).toEqual([
      { previous: 'A0', item: 'a', index: 0 },
      { previous: 'B1', item: 'b', index: 1 },
    ])
  })

  test('exposes budget.total, spent() and remaining() and counts agent usage', async () => {
    const execution = executeWorkflowScript({
      script: `
        export const meta = {"name":"budget-shape"};
        const before = { total: budget.total, spent: budget.spent(), remaining: budget.remaining() };
        await agent("one");
        return { before, after: { spent: budget.spent(), remaining: budget.remaining(), cost: budget.spentCostUsd() } };
      `,
      maxTokens: 100,
      onCall: async () => ({ value: 'ok', usage: { tokens: 30, costUsd: 0.5 } }),
    })
    expect((await execution.result).value).toEqual({
      before: { total: 100, spent: 0, remaining: 100 },
      after: { spent: 30, remaining: 70, cost: 0.5 },
    })
  })

  test('reports an unbounded budget as remaining() === Infinity', async () => {
    const execution = executeWorkflowScript({
      script: 'export const meta = {"name":"budget-unbounded"}; return { total: budget.total, infinite: budget.remaining() === Infinity };',
      onCall: async () => ({ value: null }),
    })
    expect((await execution.result).value).toEqual({ total: null, infinite: true })
  })

  test('rejects Date.now, Math.random and argless new Date because they break resume', async () => {
    const execution = executeWorkflowScript({
      script: `
        export const meta = {"name":"deterministic"};
        const attempt = fn => { try { fn(); return null; } catch (error) { return error.message; } };
        return {
          now: attempt(() => Date.now()),
          random: attempt(() => Math.random()),
          date: attempt(() => new Date()),
          fixed: new Date(0).toISOString(),
          fromArgs: new Date(args.stamp).getTime(),
        };
      `,
      args: { stamp: 1_000 },
      onCall: async () => ({ value: null }),
    })
    const value = (await execution.result).value as Record<string, unknown>
    expect(String(value.now)).toContain('Date.now()')
    expect(String(value.random)).toContain('Math.random()')
    expect(String(value.date)).toContain('new Date()')
    expect(value.fixed).toBe('1970-01-01T00:00:00.000Z')
    expect(value.fromArgs).toBe(1_000)
  })

  test('forwards saved names and { scriptPath } references to the workflow RPC', async () => {
    const refs: unknown[] = []
    const execution = executeWorkflowScript({
      script: `
        export const meta = {"name":"child-refs"};
        const a = await workflow("saved-child", { x: 1 });
        const b = await workflow({ scriptPath: "/tmp/child.js" });
        let invalid = null;
        try { await workflow({}); } catch (error) { invalid = error.message; }
        return { a, b, invalid };
      `,
      onCall: async (method, args) => { refs.push([method, args[0], args[1]]); return { value: 'child-done', usage: { agents: 2, tokens: 5 } } },
    })
    const result = await execution.result
    expect(result.value).toEqual({ a: 'child-done', b: 'child-done', invalid: expect.stringContaining('scriptPath') })
    expect(refs).toEqual([
      ['workflow', 'saved-child', { x: 1 }],
      ['workflow', { scriptPath: '/tmp/child.js' }, {}],
    ])
    expect(result.usage).toEqual({ agents: 4, tokens: 10, costUsd: 0 })
  })
})
