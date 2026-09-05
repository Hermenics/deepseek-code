import type { ParsedWorkflowSource } from './parser.js'
import { parseWorkflowSource } from './parser.js'
import { logForDebugging } from '../utils/debug.js'
import type { WorkflowEvent, WorkflowRpcResult, WorkflowUsage } from './types.js'

const MAX_PIPELINE_ITEMS = 4096
const DEFAULT_TIMEOUT_MS = 120_000
const SYNC_EXECUTION_TIMEOUT_MS = 1_000

export interface WorkflowRuntimeOptions {
  script: string
  name?: string
  args?: unknown
  timeoutMs?: number
  maxTokens?: number
  maxCostUsd?: number
  signal?: AbortSignal
  onCall(method: 'agent' | 'workflow', args: unknown[]): Promise<WorkflowRpcResult>
  onEvent?(event: WorkflowEvent): void
}

export interface WorkflowRuntimeResult {
  meta: ParsedWorkflowSource['meta']
  value: unknown
  usage: WorkflowUsage
  events: WorkflowEvent[]
}

export interface WorkflowExecution {
  result: Promise<WorkflowRuntimeResult>
  cancel(reason?: string): void
}

const WORKER_SOURCE = String.raw`
import { Script, createContext } from 'node:vm';

let nextId = 0;
const pending = new Map();

const rpc = (method, args) => new Promise((resolve, reject) => {
  const id = ++nextId;
  pending.set(id, { resolve, reject });
  postMessage({ type: 'rpc', id, method, args });
});

const workflowProgram = async function () {
  const __rpc = globalThis.__workflowBridge;
  const __deepFreeze = value => {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.freeze(value);
      for (const child of Object.values(value)) __deepFreeze(child);
    }
    return value;
  };
  const args = __deepFreeze(JSON.parse(globalThis.__workflowArgs));
  const __limits = JSON.parse(globalThis.__workflowLimits);
  delete globalThis.__workflowBridge;
  delete globalThis.__workflowArgs;
  delete globalThis.__workflowLimits;
  let __spentTokens = 0;
  let __spentCost = 0;
  let __agents = 0;
  const __call = async (method, values) => JSON.parse(await __rpc(method, JSON.stringify(values)));
  const agent = async (prompt, options = {}) => {
    if (typeof prompt !== 'string' || !prompt.trim()) throw new Error('agent prompt must be a non-empty string');
    const reply = await __call('agent', [prompt, options]);
    __agents += reply.usage?.agents ?? 1;
    __spentTokens += reply.usage?.tokens ?? 0;
    __spentCost += reply.usage?.costUsd ?? 0;
    return reply.value;
  };
  const workflow = async (ref, childArgs = {}) => {
    const named = typeof ref === 'string' && ref.trim();
    const byPath = ref && typeof ref === 'object' && typeof ref.scriptPath === 'string' && ref.scriptPath.trim();
    if (!named && !byPath) throw new Error('workflow expects a saved workflow name or { scriptPath }');
    const reply = await __call('workflow', [named ? ref : { scriptPath: ref.scriptPath }, childArgs]);
    __agents += reply.usage?.agents ?? 0;
    __spentTokens += reply.usage?.tokens ?? 0;
    __spentCost += reply.usage?.costUsd ?? 0;
    return reply.value;
  };
  const parallel = async thunks => {
    if (!Array.isArray(thunks)) throw new Error('parallel expects an array of functions');
    if (thunks.length > ${MAX_PIPELINE_ITEMS}) throw new Error('parallel item limit exceeded');
    if (thunks.some(thunk => typeof thunk !== 'function')) throw new Error('parallel expects only functions');
    const settled = await Promise.allSettled(thunks.map(thunk => Promise.resolve().then(thunk)));
    return settled.map(item => item.status === 'fulfilled' ? item.value : null);
  };
  // Every stage receives (previousResult, originalItem, index) so later stages can label work
  // without threading context through the first stage's return value. A throwing stage drops
  // the item to null and skips its remaining stages — items never block each other.
  const pipeline = async (items, ...stages) => {
    if (!Array.isArray(items)) throw new Error('pipeline expects an array');
    if (items.length > ${MAX_PIPELINE_ITEMS}) throw new Error('pipeline item limit exceeded');
    if (stages.some(stage => typeof stage !== 'function')) throw new Error('pipeline stages must be functions');
    return Promise.all(items.map(async (item, index) => {
      try {
        let value = item;
        for (const stage of stages) value = await stage(value, item, index);
        return value;
      } catch { return null; }
    }));
  };
  const log = value => { void __rpc('event', JSON.stringify(['log', String(value)])); };
  const phase = value => { void __rpc('event', JSON.stringify(['phase', String(value)])); };
  // Same shape as Claude Code: total is the run's token ceiling (null when unbounded),
  // spent()/remaining() are functions, and remaining() is Infinity without a ceiling.
  const budget = Object.freeze({
    total: __limits.maxTokens == null ? null : __limits.maxTokens,
    maxCostUsd: __limits.maxCostUsd == null ? null : __limits.maxCostUsd,
    spent: () => __spentTokens,
    remaining: () => __limits.maxTokens == null ? Infinity : Math.max(0, __limits.maxTokens - __spentTokens),
    spentCostUsd: () => __spentCost,
    remainingCostUsd: () => __limits.maxCostUsd == null ? Infinity : Math.max(0, __limits.maxCostUsd - __spentCost),
  });
  // Wall-clock and randomness would change agent prompts between runs and defeat resume, which
  // replays the journal by matching each call's arguments. Timestamps belong in args instead.
  const __nondeterministic = name => { throw new Error(name + ' is unavailable inside a workflow because it would break resume; pass timestamps or seeds through args'); };
  const __Date = Date;
  __Date.now = () => __nondeterministic('Date.now()');
  Math.random = () => __nondeterministic('Math.random()');
  globalThis.Date = new Proxy(__Date, {
    construct(target, list, newTarget) {
      if (list.length === 0) __nondeterministic('new Date()');
      return Reflect.construct(target, list, newTarget);
    },
    apply() { return __nondeterministic('Date()'); },
  });
  Object.assign(globalThis, { agent, workflow, parallel, pipeline, log, phase, args, budget });
  return { usage: () => ({ agents: __agents, tokens: __spentTokens, costUsd: __spentCost }) };
};

onmessage = async event => {
  const message = event.data;
  if (message.type === 'rpc_result') {
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error));
    else waiter.resolve(message.value);
    return;
  }
  if (message.type !== 'start') return;
  try {
    const bridge = (method, argsJson) => {
      if (method === 'event') {
        const [type, value] = JSON.parse(argsJson);
        postMessage({ type: 'event', event: { type, value, timestamp: new Date().toISOString() } });
        return Promise.resolve('null');
      }
      return rpc(method, JSON.parse(argsJson)).then(value => JSON.stringify(value));
    };
    Object.setPrototypeOf(bridge, null);
    Object.freeze(bridge);
    const sandbox = Object.assign(Object.create(null), {
      __workflowBridge: bridge,
      __workflowArgs: JSON.stringify(message.args ?? {}),
      __workflowLimits: JSON.stringify(message.limits ?? {}),
    });
    const context = createContext(sandbox, { codeGeneration: { strings: false, wasm: false } });
    const bootstrap = new Script('(' + workflowProgram.toString() + ')()', { filename: 'workflow-bootstrap.js' });
    const handle = await bootstrap.runInContext(context, { timeout: Math.max(1, message.syncTimeoutMs) });
    const program = new Script('(async () => {\n' + message.body + '\n})()', { filename: 'workflow.js' });
    const value = await program.runInContext(context, { timeout: Math.max(1, message.syncTimeoutMs) });
    postMessage({ type: 'done', value: value === undefined ? null : value, usage: handle.usage() });
  } catch (error) {
    postMessage({ type: 'error', error: error instanceof Error ? error.message : String(error) });
  }
};
`

export function executeWorkflowScript(options: WorkflowRuntimeOptions): WorkflowExecution {
  const parsed = parseWorkflowSource(options.script, options.name)
  const events: WorkflowEvent[] = []
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const blobUrl = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' }))
  const worker = new Worker(blobUrl, { type: 'module' })
  let settled = false
  let rejectResult: (error: Error) => void = () => {}
  const inFlightCalls = new Set<Promise<void>>()
  const syncTimeoutMs = Math.min(timeoutMs, SYNC_EXECUTION_TIMEOUT_MS)

  const notePendingCalls = (reason: string) => {
    if (inFlightCalls.size) logForDebugging(`[workflow] ${reason}; ${inFlightCalls.size} host RPC call(s) still in flight`)
  }

  const cleanup = () => {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', onAbort)
    worker.terminate()
    URL.revokeObjectURL(blobUrl)
  }
  const cancel = (reason = 'Workflow cancelled') => {
    if (settled) return
    settled = true
    notePendingCalls(reason)
    cleanup()
    rejectResult(new Error(reason))
  }
  const onAbort = () => cancel(options.signal?.reason instanceof Error ? options.signal.reason.message : 'Workflow cancelled')
  const timer = setTimeout(() => cancel(`Workflow timed out after ${timeoutMs}ms`), timeoutMs)

  const result = new Promise<WorkflowRuntimeResult>((resolve, reject) => {
    rejectResult = reject
    worker.onerror = event => {
      if (settled) return
      settled = true
      cleanup()
      reject(new Error(event.message || 'Workflow worker failed'))
    }
    worker.onmessage = async event => {
      const message = event.data as Record<string, unknown>
      if (message.type === 'event') {
        const workflowEvent = message.event as WorkflowEvent
        events.push(workflowEvent)
        options.onEvent?.(workflowEvent)
        return
      }
      if (message.type === 'rpc') {
        const id = Number(message.id)
        const call = (async () => {
          try {
            const value = await options.onCall(message.method as 'agent' | 'workflow', message.args as unknown[])
            if (settled) logForDebugging(`[workflow] discarded RPC result ${id} after settlement`)
            else worker.postMessage({ type: 'rpc_result', id, value })
          } catch (error) {
            if (settled) logForDebugging(`[workflow] discarded RPC error ${id} after settlement: ${(error as Error).message}`)
            else worker.postMessage({ type: 'rpc_result', id, error: (error as Error).message })
          }
        })()
        inFlightCalls.add(call)
        void call.finally(() => inFlightCalls.delete(call))
        return
      }
      if (message.type === 'done') {
        if (settled) return
        settled = true
        notePendingCalls('worker completed')
        cleanup()
        const usage = message.usage as { agents?: number; tokens?: number; costUsd?: number }
        resolve({ meta: parsed.meta, value: message.value, usage: { agents: usage.agents ?? 0, tokens: usage.tokens ?? 0, costUsd: usage.costUsd ?? 0 }, events })
        return
      }
      if (message.type === 'error') {
        if (settled) return
        settled = true
        notePendingCalls('worker failed')
        cleanup()
        const workerError = String(message.error ?? 'Workflow failed')
        const detail = workerError.includes('Script execution timed out') ? ` (synchronous workflow limit: ${syncTimeoutMs}ms)` : ''
        reject(new Error(workerError + detail))
      }
    }
    worker.postMessage({
      type: 'start', body: parsed.body, args: options.args,
      syncTimeoutMs,
      limits: { maxTokens: options.maxTokens, maxCostUsd: options.maxCostUsd },
    })
  })

  if (options.signal) {
    if (options.signal.aborted) queueMicrotask(onAbort)
    else options.signal.addEventListener('abort', onAbort, { once: true })
  }
  return { result, cancel }
}
