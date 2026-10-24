import { expect, it } from 'bun:test'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeLspSession } from '../src/lsp.js'
import { Lsp } from '../src/tools/Lsp/Lsp.js'
import { OrchestratorSession } from '../src/orchestration/OrchestratorSession.js'
import { removeTempDirectory } from './helpers/removeTempDirectory.js'

const SERVER = String.raw`
const {appendFileSync}=require('node:fs'); const log=process.argv[1],mode=process.argv[2];
const docs=new Map(); let buffer=Buffer.alloc(0),queries=0;
const send=value=>{const body=Buffer.from(JSON.stringify(value));process.stdout.write(Buffer.concat([Buffer.from('Content-Length: '+body.length+'\r\n\r\n'),body]));};
process.stdin.on('data',chunk=>{buffer=Buffer.concat([buffer,chunk]);while(true){const end=buffer.indexOf('\r\n\r\n');if(end<0)return;const len=Number(/Content-Length: (\d+)/i.exec(buffer.subarray(0,end).toString())[1]);if(buffer.length<end+4+len)return;const msg=JSON.parse(buffer.subarray(end+4,end+4+len));buffer=buffer.subarray(end+4+len);handle(msg);}});
const range={start:{line:0,character:6},end:{line:0,character:11}};
function edit(uri){return {documentChanges:[{textDocument:{uri,version:mode==='stale'?999:docs.get(uri)?.version??null},edits:[{range,newText:'fixed',...(mode==='annotated'?{annotationId:'confirmation'}:{})}]}]};}
function handle(msg){
 appendFileSync(log,JSON.stringify(msg)+'\n');
 if(msg.method==='initialize')return send({jsonrpc:'2.0',id:msg.id,result:{capabilities:{textDocumentSync:1,codeActionProvider:mode==='unsupported'?false:{resolveProvider:true},diagnosticProvider:{}}}});
 if(msg.method==='textDocument/didOpen')docs.set(msg.params.textDocument.uri,msg.params.textDocument);
 if(msg.method==='textDocument/didChange')docs.set(msg.params.textDocument.uri,{...msg.params.textDocument,text:msg.params.contentChanges[0].text});
 if(msg.method==='textDocument/didClose')docs.delete(msg.params.textDocument.uri);
 if(msg.method==='textDocument/diagnostic')return send({jsonrpc:'2.0',id:msg.id,result:{kind:'full',items:[{range,message:'fix this',code:42}]}});
 if(msg.method==='codeAction/resolve')return send({jsonrpc:'2.0',id:msg.id,result:{...msg.params,edit:edit([...docs.keys()][0]),...(mode==='resolve-command'?{command:{command:'unsafe',arguments:['private-canary']}}:{})}});
 if(msg.method!=='textDocument/codeAction')return;
 queries++;
 let uri=msg.params.textDocument.uri;
 if(mode==='outside')uri='file:///etc/passwd';
 const action={title:mode==='changed'&&queries>1?'Changed title':'Fix value',kind:'quickfix',isPreferred:true,data:{token:'private-canary'},...(mode.startsWith('resolve')?{}:{edit:mode==='resource'?{documentChanges:[{kind:'delete',uri}]}:edit(uri)}),...(mode==='command'||mode==='both'?{command:{command:'unsafe',arguments:['private-canary']}}:{}),...(mode==='disabled'?{disabled:{reason:'unavailable'}}:{})};
 if(mode==='dense')action.edit.documentChanges[0].edits=Array.from({length:80},()=>({range:{start:{line:0,character:6},end:{line:0,character:6}},newText:'x'}));
 if(mode==='command')delete action.edit;
 if(mode==='multi')action.edit.documentChanges.push(...edit(require('node:url').pathToFileURL(require('node:path').join(require('node:path').dirname(log),'other.ts')).href).documentChanges);
 const result=mode==='empty'?null:mode==='invalid'?[{title:4}]:mode==='ambiguous'?[action,action]:['large','cache-limit','oversize','output-limit'].includes(mode)?Array.from({length:mode==='oversize'?1:mode==='cache-limit'?50:100},(_,i)=>({...action,title:mode==='output-limit'?'x'.repeat(9000)+i:'Fix '+i,data:{token:'private-canary',index:i,...(mode==='cache-limit'||mode==='oversize'?{payload:'x'.repeat(mode==='oversize'?70000:12000)}:{})}})):[action];
 const reply=()=>send({jsonrpc:'2.0',id:msg.id,result});
 if(mode==='gate'&&queries===2){const timer=setInterval(()=>{if(require('node:fs').existsSync(log+'.release')){clearInterval(timer);reply();}},5);}else reply();
}
`
async function fixture(mode: string, run: (value: any) => Promise<void>) {
  const trace = (stage: string) => {
    if (process.platform === 'win32' && process.env.CI === 'true') console.log(`[lsp-code-actions] ${mode} ${stage}`)
  }
  trace('fixture start')
  const root = await mkdtemp(join(tmpdir(), 'deepseek-code-actions-'))
  const file = join(root, 'entry.ts'), log = join(root, 'server.jsonl')
  await writeFile(file, 'const value = 1\n')
  await writeFile(join(root, 'other.ts'), 'const value = 2\n')
  const session = new OrchestratorSession({ projectRoot: root, logFile: null, snapshotFile: null, settings: { memory: { enabled: false }, lsp: { timeoutMs: 2000, servers: [{ name: 'Fixture', command: process.execPath, args: ['-e', SERVER, log, mode], extensions: ['.ts'] }] } } })
  const query = async (args: Record<string, unknown>) => {
    trace(`query ${String(args.operation)} start`)
    try { return JSON.parse(await Lsp.execute({ path: file, ...args }, session.toolContext())) }
    finally { trace(`query ${String(args.operation)} end`) }
  }
  const list = (args = {}) => query({ operation: 'code_actions', line: 1, character: 7, end_character: 12, ...args })
  const preview = (id: string) => query({ operation: 'code_action_preview', action_id: id })
  const events = async () => (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
  try { await run({ root, file, session, query, list, preview, events }); trace('run end') }
  finally {
    trace('shutdown start')
    await session.shutdown()
    trace('shutdown end')
    await removeTempDirectory(root)
    trace('cleanup end')
  }
}

for (const mode of ['edit', 'resolve', 'multi']) it(`previews ${mode} actions through synchronized hash-bound text proposals`, async () => {
  await fixture(mode, async ({ file, list, preview, events }) => {
    const listing = await list()
    expect(listing.result.actions).toHaveLength(1)
    expect(JSON.stringify(listing)).not.toContain('private-canary')
    const result = await preview(listing.result.actions[0].id)
    expect(result.result.status).toBe('proposal-only')
    expect(result.result.files).toHaveLength(mode === 'multi' ? 2 : 1)
    expect(result.result.files[0].arguments.expected_hash).toMatch(/^[a-f0-9]{64}$/)
    expect(result.result.files[0].arguments.text_edits[0].newText).toBe('fixed')
    expect(await readFile(file, 'utf8')).toBe('const value = 1\n')
    const log = await events()
    expect(log.some((event: any) => event.method === 'workspace/executeCommand')).toBe(false)
    expect(log.filter((event: any) => event.method === 'codeAction/resolve').length).toBe(mode === 'resolve' ? 1 : 0)
    expect(log.find((event: any) => event.method === 'initialize').params.capabilities.textDocument.codeAction.resolveSupport.properties).toEqual(['edit'])
  })
})

for (const mode of ['command', 'both', 'resolve-command', 'disabled', 'ambiguous', 'changed', 'resource', 'annotated', 'stale', 'outside']) it(`refuses ${mode} actions without partial edits or command execution`, async () => {
  await fixture(mode, async ({ file, list, preview, events }) => {
    const listing = await list()
    await expect(preview(listing.result.actions[0].id)).rejects.toThrow()
    expect(await readFile(file, 'utf8')).toBe('const value = 1\n')
    expect((await events()).some((event: any) => event.method === 'workspace/executeCommand')).toBe(false)
  })
})

it('invalidates action IDs after source changes or a fresh connection', async () => {
  await fixture('edit', async ({ file, session, list, preview }) => {
    const listing = await list()
    await writeFile(file, 'const value = 3\n')
    await expect(preview(listing.result.actions[0].id)).rejects.toThrow('expired')
    const fresh = await list()
    await closeLspSession(session)
    await expect(preview(fresh.result.actions[0].id)).rejects.toThrow('expired')
  })
})

it('bounds listings and keeps opaque data private', async () => {
  await fixture('large', async ({ list }) => {
    const result = await list()
    expect(result.result.actions).toHaveLength(32)
    expect(result.result.omitted).toBe(68)
    expect(result.result.truncated).toBe(true)
    expect(JSON.stringify(result)).not.toContain('private-canary')
  })
})

it('reuses bounded pull diagnostics as explicitly labeled action context', async () => {
  await fixture('edit', async ({ query, list, events }) => {
    await query({ operation: 'diagnostics' })
    const result = await list()
    expect(result.result.diagnosticContext).toBe('request')
    expect((await events()).find((event: any) => event.method === 'textDocument/codeAction').params.context.diagnostics[0].code).toBe(42)
  })
})

for (const args of [{ line: 200 }, { character: 100 }, { end_character: 1 }, { end_line: 0 }, { end_character: '12' }, { end_character: null }]) it(`rejects invalid code action range ${JSON.stringify(args)}`, async () => {
  await fixture('edit', async ({ list, events }) => {
    await expect(list(args)).rejects.toThrow()
    expect((await events()).some((event: any) => event.method === 'textDocument/codeAction')).toBe(false)
  })
})

for (const mode of ['unsupported', 'invalid']) it(`refuses ${mode} providers`, async () => {
  await fixture(mode, async ({ list }) => { await expect(list()).rejects.toThrow() })
})

it('returns an empty action list for null responses', async () => {
  await fixture('empty', async ({ list }) => { expect((await list()).result.actions).toEqual([]) })
})

for (const mode of ['cache-limit', 'oversize', 'output-limit']) it(`bounds ${mode} action retention`, async () => {
  await fixture(mode, async ({ list }) => {
    const result = await list()
    expect(result.result.truncated).toBe(true)
    expect(result.result.omitted).toBeGreaterThan(0)
    expect(result.result.actions.length).toBeLessThan(32)
    expect(Buffer.byteLength(JSON.stringify(result.result.actions))).toBeLessThan(16_002)
  })
})

it('invalidates earlier listings even when source and titles match', async () => {
  await fixture('edit', async ({ list, preview }) => {
    const first = await list()
    const second = await list()
    expect(second.result.actions[0].id).not.toBe(first.result.actions[0].id)
    await expect(preview(first.result.actions[0].id)).rejects.toThrow('expired')
  })
})

it('refuses source changes while a code action query is pending', async () => {
  await fixture('gate', async ({ root, file, list, preview, events }) => {
    const listing = await list()
    const pending = preview(listing.result.actions[0].id)
    const observed = pending.catch((error: unknown) => error)
    try {
      const deadline = Date.now() + 1500
      while ((await events()).filter((event: any) => event.method === 'textDocument/codeAction').length < 2) {
        if (Date.now() > deadline) throw new Error('Code action request was not observed')
        await Bun.sleep(5)
      }
      await writeFile(file, 'const value = 9\n')
    } finally { await writeFile(join(root, 'server.jsonl.release'), '') }
    await expect(pending).rejects.toThrow('changed during the query')
    await observed
    expect(await readFile(file, 'utf8')).toBe('const value = 9\n')
  })
})

it('keeps the complete serialized proposal below the tool output budget', async () => {
  await fixture('dense', async ({ file, session, list }) => {
    const listing = await list()
    const output = await Lsp.execute({ operation: 'code_action_preview', path: file, action_id: listing.result.actions[0].id }, session.toolContext())
    expect(Buffer.byteLength(output)).toBeLessThanOrEqual(32_000)
    expect(JSON.parse(output).result.files[0].arguments.text_edits).toHaveLength(80)
    expect(JSON.parse(output).result.files[0].preview).toHaveLength(80)
  })
})
