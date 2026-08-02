import { describe, expect, test } from 'bun:test'
import { executeWorkflowScript } from '../../src/workflows/runtime.js'

describe('workflow runtime', () => {
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
      timeoutMs: 80,
      onCall: async () => ({ value: null }),
    })
    await expect(execution.result).rejects.toThrow('timed out')
  })
})
