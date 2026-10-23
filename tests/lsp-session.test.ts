import { expect, it } from 'bun:test'
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeLspSession, runLspRequest, type LspOperation } from '../src/lsp.js'
import { Lsp } from '../src/tools/Lsp/Lsp.js'
import { Grep } from '../src/tools/Grep/Grep.js'
import { OrchestratorSession } from '../src/orchestration/OrchestratorSession.js'
import { removeTempDirectory } from './helpers/removeTempDirectory.js'

const SERVER = String.raw`
const {appendFileSync}=require('node:fs');
const log=process.argv[1]; const mode=process.argv[2];
let buffer=Buffer.alloc(0); const docs=new Map(); let editAnswered=false; let pendingHover; let renameRequests=0;
if(mode==='helper')require('node:child_process').spawn(process.execPath,['-e',"require('node:fs').writeFileSync(process.argv[1],JSON.stringify({pid:process.pid}));setInterval(()=>{},10000)",log+'.helper'],{stdio:'ignore'});
const send=value=>{const body=Buffer.from(JSON.stringify(value));process.stdout.write(Buffer.concat([Buffer.from('Content-Length: '+body.length+'\r\n\r\n'),body]));};
process.stdin.on('data',chunk=>{buffer=Buffer.concat([buffer,chunk]);while(true){const end=buffer.indexOf('\r\n\r\n');if(end<0)return;const len=Number(/Content-Length: (\d+)/i.exec(buffer.subarray(0,end).toString())[1]);if(buffer.length<end+4+len)return;const msg=JSON.parse(buffer.subarray(end+4,end+4+len));buffer=buffer.subarray(end+4+len);handle(msg);}});
function handle(msg){
 appendFileSync(log,JSON.stringify({pid:process.pid,method:msg.method,params:msg.params,result:msg.result,secretPresent:Boolean(process.env.DEEPSEEK_API_KEY)})+'\n');
 if(msg.id==='apply'){editAnswered=true;if(pendingHover)handle(pendingHover);}
 if(msg.method==='initialize') {if(mode==='oversize'){process.stdout.write('Content-Length: 9000000\r\n\r\n');return;}if(mode==='invalid'){send({jsonrpc:'2.0',id:msg.id});return;}send({jsonrpc:'2.0',id:msg.id,result:{capabilities:{textDocumentSync:mode==='no-sync'?0:1,...(mode==='rename-utf8'?{positionEncoding:'utf-8'}:{}),...(mode.startsWith('rename-')?{renameProvider:{prepareProvider:true}}:{}),...(mode.startsWith('pull-')?{diagnosticProvider:{identifier:'fixture',interFileDependencies:true,workspaceDiagnostics:false}}:{})}}});return;}
 if(msg.method==='initialized'&&mode==='apply-edit')send({jsonrpc:'2.0',id:'apply',method:'workspace/applyEdit',params:{edit:{changes:{}}}});
 if(msg.method==='textDocument/didOpen')docs.set(msg.params.textDocument.uri,{text:msg.params.textDocument.text,version:msg.params.textDocument.version});
 if(msg.method==='textDocument/didChange')docs.set(msg.params.textDocument.uri,{text:msg.params.contentChanges[0].text,version:msg.params.textDocument.version});
 if(msg.method==='textDocument/documentSymbol'){const range={start:{line:0,character:0},end:{line:3,character:1}};send({jsonrpc:'2.0',id:msg.id,result:[{name:'module',kind:1,range,selectionRange:range,children:[{name:'lookup',kind:12,range,selectionRange:range,children:[]}]}]});return;}
 if(msg.method==='textDocument/didClose')docs.delete(msg.params.textDocument.uri);
 if(['textDocument/didOpen','textDocument/didChange'].includes(msg.method)&&mode.startsWith('push-')){
  const uri=msg.params.textDocument.uri;const doc=docs.get(uri);
  const item={range:{start:{line:0,character:0},end:{line:0,character:1}},severity:1,message:doc.text.includes('value = 2')?'new diagnostic':'old diagnostic',source:'fixture'};
  const publish=()=>{
   if(mode==='push-stale'){
    send({jsonrpc:'2.0',method:'textDocument/publishDiagnostics',params:{uri:'file:///outside-scope',version:doc.version,diagnostics:[{message:'outside canary'}]}});
    for(const version of [doc.version-1,doc.version+1])send({jsonrpc:'2.0',method:'textDocument/publishDiagnostics',params:{uri,version,diagnostics:[{...item,message:'stale canary'}]}});
   }
   send({jsonrpc:'2.0',method:'textDocument/publishDiagnostics',params:{uri,...(mode.startsWith('push-unversioned')?{}:{version:doc.version}),diagnostics:mode==='push-empty'?[]:mode==='push-unversioned-limit'?Array.from({length:400},()=>({...item,message:'x'.repeat(2000)})):mode==='push-limit'?Array.from({length:400},()=>item):mode==='push-invalid'?[{message:'missing range'}]:[item]}});
  };
  if(mode==='push-gate'){const timer=setInterval(()=>{if(require('node:fs').existsSync(log+'.diagnostic-release')){clearInterval(timer);publish();}},5);}else publish();
 }
 if(msg.method==='textDocument/diagnostic'){send({jsonrpc:'2.0',id:msg.id,result:mode==='pull-unchanged'?{kind:'unchanged',resultId:'invalid-without-previous-id'}:{kind:'full',items:mode==='pull-empty'?[]:[{range:{start:{line:0,character:0},end:{line:0,character:1}},severity:1,message:'pulled diagnostic'}],relatedDocuments:{'file:///outside-scope':{kind:'full',items:[{message:'outside canary'}]}}}});return;}
 if(msg.method==='textDocument/hover') {if(mode==='hang')return;if(mode==='apply-edit'&&!editAnswered){pendingHover=msg;return;}const reply=()=>send({jsonrpc:'2.0',id:msg.id,result:{pid:process.pid,documents:[...docs],contents:docs.get(msg.params.textDocument.uri)}});if(mode==='gate'){const timer=setInterval(()=>{if(require('node:fs').existsSync(log+'.release')){clearInterval(timer);reply();}},5);}else if(mode==='delay')setTimeout(reply,100);else reply();}
 if(msg.method==='textDocument/prepareRename'){send({jsonrpc:'2.0',id:msg.id,result:mode==='rename-null'?null:{start:{line:0,character:6},end:{line:0,character:11}}});return;}
 if(msg.method==='textDocument/rename'){
  renameRequests++;const uri=msg.params.textDocument.uri;const other=require('node:url').pathToFileURL(require('node:path').join(require('node:path').dirname(log),mode==='rename-unstable'?'other-'+renameRequests+'.ts':'other.ts')).href;
  const edits=[{range:{start:{line:0,character:6},end:{line:0,character:11}},newText:msg.params.newName,...(mode==='rename-annotated'?{annotationId:'confirmation'}:{})}];
  const second=[{range:{start:{line:0,character:12},end:{line:0,character:17}},newText:msg.params.newName}];
  const target=mode==='rename-outside'?'file:///etc/passwd':other;
  const changes=[{textDocument:{uri,version:mode==='rename-stale'?docs.get(uri).version+1:docs.get(uri).version},edits},{textDocument:{uri:target,version:docs.get(target)?.version??null},edits:second}];
  const result=mode==='rename-noedit'?null:mode==='rename-budget'?{documentChanges:[{textDocument:{uri,version:docs.get(uri).version},edits:Array.from({length:200},(_,index)=>({range:{start:{line:0,character:index*6},end:{line:0,character:index*6+5}},newText:msg.params.newName}))}]}:mode==='rename-large'?{documentChanges:[{textDocument:{uri,version:docs.get(uri).version},edits:Array.from({length:201},()=>edits[0])}]}:mode==='rename-resource'?{documentChanges:[{kind:'delete',uri}]}:mode==='rename-changes'?{changes:{[uri]:edits,[other]:second}}:{documentChanges:changes};
  const reply=()=>send({jsonrpc:'2.0',id:msg.id,result});if(mode==='rename-gate'&&renameRequests>1){const timer=setInterval(()=>{if(require('node:fs').existsSync(log+'.rename-release')){clearInterval(timer);reply();}},5);}else reply();return;
 }
 if(msg.method==='shutdown')send({jsonrpc:'2.0',id:msg.id,result:null});
 if(msg.method==='exit')process.exit(0);
}
`
async function fixture(run: (value: any) => Promise<void>, mode = '') {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'deepseek-lsp-session-')))
  const owner = {}
  const log = join(root, 'server.jsonl')
  const file = join(root, 'entry.ts')
  await writeFile(file, 'export const value = 1')
  const settings = { memory: { enabled: false }, lsp: { timeoutMs: 1000, servers: [{ name: 'Fixture', command: process.execPath, args: ['-e', SERVER, log, mode], extensions: ['.ts'] }] } }
  const request = async (filePath = file, extra = {}, operation: LspOperation = 'hover') => runLspRequest(settings, { operation, workspacePath: root, filePath, fileContent: await readFile(filePath, 'utf8'), line: 1, character: 1 }, { owner, readDocument: (path: string) => readFile(path, 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error }), ...extra })
  try { await run({ root, file, owner, settings, request, diagnostics: (path = file) => request(path, {}, 'diagnostics'), events: async () => (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line)) }) }
  finally { closeLspSession(owner); await removeTempDirectory(root) }
}

it('reuses one server and synchronizes changed open files with increasing versions', async () => {
  await fixture(async ({ root, file, request, events }) => {
    const first = await request()
    const other = join(root, 'other.ts'); await writeFile(other, 'export const other = 1')
    await request(other)
    await writeFile(file, 'export const value = 2')
    const second = await request()
    expect(second.result.pid).toBe(first.result.pid)
    expect(second.generation).toBe(first.generation)
    expect(second.document.version).toBeGreaterThan(first.document.version)
    expect(second.document.hash).not.toBe(first.document.hash)
    expect(second.result.contents.text).toBe('export const value = 2')
    await writeFile(other, 'export const other = 2')
    const third = await request()
    expect(third.result.documents.some(([, doc]: any) => doc.text === 'export const other = 2')).toBe(true)
    const log = await events()
    expect(log.filter((event: any) => event.method === 'initialize')).toHaveLength(1)
    expect(log.filter((event: any) => event.method === 'textDocument/didOpen')).toHaveLength(2)
    expect(log.filter((event: any) => event.method === 'textDocument/didChange')).toHaveLength(2)
  })
})

it('keeps owners and changed server settings separate and closes owned processes', async () => {
  await fixture(async ({ owner, settings, request }) => {
    const first = await request()
    const separate = {}
    try {
      const second = await request(undefined, { owner: separate })
      expect(second.result.pid).not.toBe(first.result.pid)
    } finally { closeLspSession(separate) }
    settings.lsp.servers[0].name = 'Changed configuration'
    const changed = await request()
    expect(changed.result.pid).not.toBe(first.result.pid)
    closeLspSession(owner)
    const restarted = await request()
    expect(restarted.result.pid).not.toBe(changed.result.pid)
    expect(restarted.generation).not.toBe(changed.generation)
  })
})

it('serializes concurrent document versions without confusing replies', async () => {
  await fixture(async ({ request, file, root, events }) => {
    const first = request()
    const observed = first.catch((error: unknown) => error)
    try {
      let ready = false
      for (let attempt = 0; attempt < 100; attempt++) {
        ready = await events().then((log: any[]) => log.some(event => event.method === 'textDocument/hover'), () => false)
        if (ready) break
        await Bun.sleep(5)
      }
      expect(ready).toBe(true)
      await writeFile(file, 'export const value = 2')
      const second = request()
      await writeFile(join(root, 'server.jsonl.release'), 'release')
      const results = await Promise.all([first, second])
      expect(results[0].result.pid).toBe(results[1].result.pid)
      expect(results[0].document.version).toBeLessThan(results[1].document.version)
      expect(results[0].result.contents.text).toBe('export const value = 1')
      expect(results[1].result.contents.text).toBe('export const value = 2')
    } finally { await writeFile(join(root, 'server.jsonl.release'), 'release'); await observed }
  }, 'gate')
})

it('aborts a stalled server request and allows a clean later connection', async () => {
  await fixture(async ({ settings, request }) => {
    const controller = new AbortController()
    const pending = request(undefined, { signal: controller.signal })
    const timer = setTimeout(() => controller.abort(new Error('Stop LSP query')), 100)
    try { await expect(pending).rejects.toThrow('Stop LSP query') } finally { clearTimeout(timer) }
    settings.lsp.servers[0].args[3] = ''
    expect((await request()).result.contents.text).toContain('value')
  }, 'hang')
})

it('rejects oversized protocol frames without waiting for the declared body', async () => {
  await fixture(async ({ request }) => { await expect(request()).rejects.toThrow(/limit|large/i) }, 'oversize')
})

it('rejects malformed responses and times out stalled requests', async () => {
  await fixture(async ({ request }) => { await expect(request()).rejects.toThrow('Invalid LSP response') }, 'invalid')
  await fixture(async ({ request, settings }) => { settings.lsp.timeoutMs = 100; await expect(request()).rejects.toThrow('timed out') }, 'hang')
})

it('cancels a queued request without cancelling another callers active request', async () => {
  await fixture(async ({ root, request, events }) => {
    const active = request()
    const observed = active.then((value: any) => ({ value }), (error: unknown) => ({ error }))
    let queued: Promise<any> | undefined
    try {
      let started = false
      for (let attempt = 0; attempt < 100; attempt++) {
        started = await events().then((log: any[]) => log.some(event => event.method === 'textDocument/hover'), () => false)
        if (started) break
        await new Promise(resolve => setTimeout(resolve, 5))
      }
      expect(started).toBe(true)
      const controller = new AbortController()
      let entered!: () => void
      const registered = new Promise<void>(resolve => { entered = resolve })
      const listen = controller.signal.addEventListener.bind(controller.signal)
      ;(controller.signal as any).addEventListener = (...args: any[]) => { (listen as any)(...args); entered() }
      queued = request(undefined, { signal: controller.signal })
      await registered
      controller.abort(new Error('Cancel queued request'))
      await expect(queued).rejects.toThrow('Cancel queued request')
      await writeFile(join(root, 'server.jsonl.release'), 'release')
      const later = request()
      const first = await active
      expect(first.result.contents.text).toContain('value')
      expect((await later).result.pid).toBe(first.result.pid)
    } finally {
      await writeFile(join(root, 'server.jsonl.release'), 'release')
      await observed
      if (queued) await queued.catch(() => undefined)
    }
  }, 'gate')
})

it('bounds document retention and closes documents removed from disk', async () => {
  await fixture(async ({ root, file, request, events }) => {
    await request()
    for (let index = 0; index < 33; index++) {
      const other = join(root, `other-${index}.ts`)
      await writeFile(other, 'export const other = 1')
      await request(other)
    }
    const last = join(root, 'other-32.ts'); await rm(last)
    const result = await request()
    expect(result.result.documents.length).toBeLessThanOrEqual(32)
    expect(result.result.documents.some(([uri]: any) => uri.endsWith('/other-32.ts'))).toBe(false)
    expect((await events()).some((event: any) => event.method === 'textDocument/didClose')).toBe(true)
    await writeFile(file, 'x'.repeat(524_289))
    await expect(request()).rejects.toThrow('byte limit')
  })
})

it('scrubs provider credentials and refuses server-initiated edits', async () => {
  const previous = process.env.DEEPSEEK_API_KEY
  process.env.DEEPSEEK_API_KEY = 'synthetic-lsp-canary'
  try {
    await fixture(async ({ request, events }) => {
      await request()
      const log = await events()
      expect(log.every((event: any) => !event.secretPresent)).toBe(true)
      expect(log.some((event: any) => event.result?.applied === false)).toBe(true)
    }, 'apply-edit')
  } finally {
    if (previous === undefined) delete process.env.DEEPSEEK_API_KEY
    else process.env.DEEPSEEK_API_KEY = previous
  }
})

it('integrates tool versions and real session configuration/root/shutdown lifecycle', async () => {
  await fixture(async ({ root, file, settings }) => {
    const session = new OrchestratorSession({ projectRoot: root, settings, logFile: null, snapshotFile: null })
    const args = { operation: 'hover', path: file, line: 1, character: 1 }
    try {
      const first = JSON.parse(await Lsp.execute(args, session.toolContext()))
      const warm = JSON.parse(await Lsp.execute(args, session.toolContext()))
      expect(warm.result.pid).toBe(first.result.pid)
      expect(warm.document.version).toBe(1)
      session.configure({ settings: { ...settings, lsp: { ...settings.lsp, timeoutMs: 2000 } } })
      const configured = JSON.parse(await Lsp.execute(args, session.toolContext()))
      expect(configured.result.pid).not.toBe(first.result.pid)
      await session.changeProjectRoot(root)
      const moved = JSON.parse(await Lsp.execute(args, session.toolContext()))
      expect(moved.result.pid).not.toBe(configured.result.pid)
      await session.shutdown()
      await new Promise(resolve => setTimeout(resolve, 20))
      expect(() => process.kill(moved.result.pid, 0)).toThrow()
    } finally { await session.shutdown() }
  })
})

it('groups grep matches by configured language-server symbols and reports file fallback', async () => {
  await fixture(async ({ root, file, settings }) => {
    await writeFile(file, "function lookup() {\n  return 'needle';\n}\n")
    const notes = join(root, 'notes.txt')
    await writeFile(notes, 'needle in plain text\n')
    const session = new OrchestratorSession({ projectRoot: root, settings, logFile: null, snapshotFile: null })
    try {
      const result = await Grep.execute({ pattern: 'needle', path: root, group_by: 'symbol' }, session.toolContext())
      expect(result).toContain(`${file}\n  module > lookup\n    2:  return 'needle';`)
      expect(result).toContain(`${notes}\n  <file-level fallback>\n    1:needle in plain text`)
      expect(result).toContain('Symbol grouping fell back to file-level output for 1 file')
    } finally { await session.shutdown() }
  })
})

it('rejects tool results for source changes made while a response is pending', async () => {
  await fixture(async ({ root, file, settings, events }) => {
    const session = new OrchestratorSession({ projectRoot: root, settings, logFile: null, snapshotFile: null })
    const pending = Lsp.execute({ operation: 'hover', path: file, line: 1, character: 1 }, session.toolContext())
    try {
      for (let attempt = 0; attempt < 100; attempt++) {
        if (await events().then((log: any[]) => log.some((event: any) => event.method === 'textDocument/hover'), () => false)) break
        await new Promise(resolve => setTimeout(resolve, 5))
      }
      await writeFile(file, 'export const changed = 1')
      await expect(pending).rejects.toThrow('changed during the query')
    } finally { await session.shutdown() }
  }, 'delay')
})

it('refuses stale buffers when the server cannot synchronize document changes', async () => {
  await fixture(async ({ file, request }) => {
    await request()
    await writeFile(file, 'export const value = 2')
    await expect(request()).rejects.toThrow('does not support document change synchronization')
    expect((await request()).result.contents.text).toBe('export const value = 2')
  }, 'no-sync')
})

it.skipIf(process.platform !== 'linux')('terminates helpers in the owned language-server process group', async () => {
  await fixture(async ({ root, owner, request }) => {
    await request()
    const ready = join(root, 'server.jsonl.helper')
    let pid: number | undefined
    const alive = async () => {
      if (!pid) return false
      try {
        const stat = await readFile(`/proc/${pid}/stat`, 'utf8')
        const state = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[0]
        return state !== 'Z' && state !== 'X' && (await readFile(`/proc/${pid}/cmdline`, 'utf8')).includes(ready)
      } catch { return false }
    }
    try {
      for (let attempt = 0; attempt < 100; attempt++) {
        try { pid = JSON.parse(await readFile(ready, 'utf8')).pid; break } catch { await new Promise(resolve => setTimeout(resolve, 5)) }
      }
      expect(await alive()).toBe(true)
      closeLspSession(owner)
      for (let attempt = 0; attempt < 100 && await alive(); attempt++) await new Promise(resolve => setTimeout(resolve, 5))
      expect(await alive()).toBe(false)
    } finally { if (await alive()) process.kill(pid!, 'SIGKILL') }
  }, 'helper')
})

it('rechecks protected scope before synchronizing an older open document', async () => {
  await fixture(async ({ root, file, settings }) => {
    const session = new OrchestratorSession({ projectRoot: root, settings, logFile: null, snapshotFile: null })
    const other = join(root, 'other.ts'); await writeFile(other, 'export const privateValue = 1')
    const args = { operation: 'hover', path: file, line: 1, character: 1 }
    try {
      await Lsp.execute({ ...args, path: other }, session.toolContext())
      await expect(Lsp.execute(args, { ...session.toolContext(), protectedPaths: [other] })).rejects.toThrow()
    } finally { await session.shutdown() }
  })
})

it('shutdown interrupts a pending document refresh without waiting for its callback', async () => {
  await fixture(async ({ root, owner, request }) => {
    await request()
    const other = join(root, 'other.ts'); await writeFile(other, 'export const other = 1')
    let entered!: () => void
    const ready = new Promise<void>(resolve => { entered = resolve })
    const pending = request(other, { readDocument: () => { entered(); return new Promise(() => {}) } })
    await ready
    closeLspSession(owner)
    await expect(pending).rejects.toThrow('LSP session closed')
    expect((await request()).result.contents.text).toContain('value')
  })
})

it('bounds and validates text at the tool file boundary before starting a server', async () => {
  await fixture(async ({ root, file, settings, events }) => {
    const session = new OrchestratorSession({ projectRoot: root, settings, logFile: null, snapshotFile: null })
    const args = { operation: 'hover', path: file, line: 1, character: 1 }
    try {
      await writeFile(file, 'x'.repeat(524_289))
      await expect(Lsp.execute(args, session.toolContext())).rejects.toThrow('file limits')
      await writeFile(file, Buffer.from([255]))
      await expect(Lsp.execute(args, session.toolContext())).rejects.toThrow()
      await writeFile(file, 'binary\0data')
      await expect(Lsp.execute(args, session.toolContext())).rejects.toThrow('text document')
      expect(await events().then(() => true, () => false)).toBe(false)
    } finally { await session.shutdown() }
  })
})


it('binds pushed diagnostics to source versions and ignores earlier-version notifications', async () => {
  await fixture(async ({ file, diagnostics, events }) => {
    const first = await diagnostics()
    expect(first.result.status).toBe('reported')
    expect(first.result.versionBinding).toBe('server')
    expect(first.result.items[0].message).toBe('old diagnostic')
    expect(JSON.stringify(first)).not.toContain('stale canary')
    expect(JSON.stringify(first)).not.toContain('outside canary')
    const warm = await diagnostics()
    expect(warm.result.cached).toBe(true)
    await writeFile(file, 'export const value = 2')
    const edited = await diagnostics()
    expect(edited.document.version).toBeGreaterThan(first.document.version)
    expect(edited.result.items[0].message).toBe('new diagnostic')
    expect(edited.result.scope).toBe('requested-document')
    const initialized = (await events()).find((event: any) => event.method === 'initialize')
    expect(initialized.params.capabilities.textDocument.publishDiagnostics.versionSupport).toBe(true)
  }, 'push-stale')
})

it('does not present unversioned or missing publications as a clean current report', async () => {
  await fixture(async ({ diagnostics }) => {
    const result = await diagnostics()
    expect(result.result.status).toBe('unversioned')
    expect(result.result.versionBinding).toBe('unverified')
    expect(result.result.items).toEqual([])
    expect(result.result.omitted).toBe(1)
    expect(result.result.omittedReason).toBe('unverified-document-version')
    expect(result.result.unverified.items[0].message).toBe('old diagnostic')
    expect(result.result.unverified.truncated).toBe(false)
  }, 'push-unversioned')
  await fixture(async ({ settings, diagnostics }) => {
    settings.lsp.timeoutMs = 100
    await expect(diagnostics()).rejects.toThrow('timed out')
  })
})

it('bounds unversioned diagnostic hints without promoting them to version-bound items', async () => {
  await fixture(async ({ diagnostics }) => {
    const result = await diagnostics()
    expect(result.result.status).toBe('unversioned')
    expect(result.result.items).toEqual([])
    expect(result.result.unverified.items.length).toBeLessThanOrEqual(200)
    expect(result.result.unverified.omitted).toBeGreaterThan(0)
    expect(result.result.unverified.truncated).toBe(true)
    expect(Buffer.byteLength(JSON.stringify(result.result))).toBeLessThanOrEqual(66_000)
  }, 'push-unversioned-limit')
})

it('distinguishes a versioned empty publication from missing diagnostics and bounds retained reports', async () => {
  await fixture(async ({ diagnostics }) => {
    const empty = await diagnostics()
    expect(empty.result.status).toBe('reported')
    expect(empty.result.items).toEqual([])
    expect(empty.result.truncated).toBe(false)
  }, 'push-empty')
  await fixture(async ({ diagnostics }) => {
    const bounded = await diagnostics()
    expect(bounded.result.items.length).toBeLessThanOrEqual(200)
    expect(bounded.result.omitted).toBeGreaterThan(0)
    expect(bounded.result.truncated).toBe(true)
    expect(Buffer.byteLength(JSON.stringify(bounded.result))).toBeLessThanOrEqual(66_000)
  }, 'push-limit')
})

it('requests supported pull diagnostics with explicit request binding and no unrelated documents', async () => {
  await fixture(async ({ diagnostics, events }) => {
    const pulled = await diagnostics()
    expect(pulled.result.mode).toBe('pull')
    expect(pulled.result.versionBinding).toBe('request')
    expect(pulled.result.items[0].message).toBe('pulled diagnostic')
    expect(JSON.stringify(pulled)).not.toContain('outside canary')
    expect(pulled.result.buildContext).toBe('not-verified')
    expect((await events()).some((event: any) => event.method === 'textDocument/diagnostic' && event.params.identifier === 'fixture')).toBe(true)
  }, 'pull-normal')
  await fixture(async ({ diagnostics }) => {
    expect((await diagnostics()).result.items).toEqual([])
  }, 'pull-empty')
})

it('rejects malformed publications and unchanged pull reports without a previous result', async () => {
  await fixture(async ({ diagnostics }) => { await expect(diagnostics()).rejects.toThrow('Invalid LSP diagnostic') }, 'push-invalid')
  await fixture(async ({ diagnostics }) => { await expect(diagnostics()).rejects.toThrow('full diagnostic report') }, 'pull-unchanged')
})

it('exposes diagnostics through the version-checked tool without requiring a cursor position', async () => {
  await fixture(async ({ root, file, settings }) => {
    const session = new OrchestratorSession({ projectRoot: root, settings, logFile: null, snapshotFile: null })
    try {
      const result = JSON.parse(await Lsp.execute({ operation: 'diagnostics', path: file }, session.toolContext()))
      expect(result.result.items[0].message).toBe('old diagnostic')
      expect(result.document.hash).toMatch(/^[a-f0-9]{64}$/)
    } finally { await session.shutdown() }
  }, 'push-normal')
})

it('refreshes discarded push reports and never reuses document versions after reopen', async () => {
  await fixture(async ({ root, file, diagnostics, events }) => {
    const first = await diagnostics()
    first.result.items[0].message = 'mutated caller data'
    expect((await diagnostics()).result.items[0].message).toBe('old diagnostic')
    const other = join(root, 'other.ts'); await writeFile(other, 'export const other = 1')
    await diagnostics(other)
    const reopened = await diagnostics()
    expect(reopened.document.version).toBeGreaterThan(first.document.version)
    expect(reopened.result.items[0].message).toBe('old diagnostic')
    const log = await events()
    const versions = log.filter((event: any) => event.method === 'textDocument/didOpen' && event.params.textDocument.uri.endsWith('/entry.ts')).map((event: any) => event.params.textDocument.version)
    expect(new Set(versions).size).toBe(versions.length)
    expect(reopened.document.path).toBe(file)
  }, 'push-stale')
})

it('cancels a pending diagnostic publication without returning an empty report', async () => {
  await fixture(async ({ file, request, events }) => {
    const controller = new AbortController()
    const pending = request(file, { signal: controller.signal }, 'diagnostics')
    const observed = pending.catch((error: unknown) => error)
    let opened = false
    try {
      for (let attempt = 0; attempt < 100; attempt++) {
        opened = await events().then((log: any[]) => log.some(event => event.method === 'textDocument/didOpen'), () => false)
        if (opened) break
        await new Promise(resolve => setTimeout(resolve, 5))
      }
      expect(opened).toBe(true)
      controller.abort(new Error('Cancel diagnostics'))
      await expect(pending).rejects.toThrow('Cancel diagnostics')
    } finally { controller.abort(); await observed }
  })
})


it('rejects diagnostic results when the source changes before publication', async () => {
  await fixture(async ({ root, file, settings, events }) => {
    const session = new OrchestratorSession({ projectRoot: root, settings, logFile: null, snapshotFile: null })
    const pending = Lsp.execute({ operation: 'diagnostics', path: file }, session.toolContext())
    const observed = pending.catch((error: unknown) => error)
    let opened = false
    try {
      for (let attempt = 0; attempt < 100; attempt++) {
        opened = await events().then((log: any[]) => log.some(event => event.method === 'textDocument/didOpen'), () => false)
        if (opened) break
        await new Promise(resolve => setTimeout(resolve, 5))
      }
      expect(opened).toBe(true)
      await writeFile(file, 'export const changed = 1')
      await writeFile(join(root, 'server.jsonl.diagnostic-release'), 'release')
      await expect(pending).rejects.toThrow('changed during the query')
    } finally { await session.shutdown(); await observed }
  }, 'push-gate')
})


it('discovers and snapshots every rename target before returning a read-only proposal', async () => {
  await fixture(async ({ root, file, settings, events }) => {
    const { EditFile } = await import('../src/tools/EditFile/EditFile.js')
    const other = join(root, 'other.ts')
    await writeFile(file, 'const value = 1\r\n'); await writeFile(other, 'console.log(value)\r\n')
    const session = new OrchestratorSession({ projectRoot: root, settings, logFile: null, snapshotFile: null })
    try {
      const result = JSON.parse(await Lsp.execute({ operation: 'rename_preview', path: file, line: 1, character: 7, new_name: 'renamed' }, session.toolContext()))
      expect(result.result.status).toBe('proposal-only')
      expect(result.result.files).toHaveLength(2)
      expect(await readFile(file, 'utf8')).toBe('const value = 1\r\n')
      expect(await readFile(other, 'utf8')).toBe('console.log(value)\r\n')
      expect((await events()).filter((event: any) => event.method === 'textDocument/rename')).toHaveLength(2)
      for (const target of result.result.files) {
        expect(target.arguments.expected_hash).toMatch(/^[a-f0-9]{64}$/)
        expect(target.preview[0].before).toBe('value')
        await EditFile.execute(target.arguments, session.toolContext())
      }
      expect(await readFile(file, 'utf8')).toBe('const renamed = 1\r\n')
      expect(await readFile(other, 'utf8')).toBe('console.log(renamed)\r\n')
    } finally { await session.shutdown() }
  }, 'rename-normal')
})

it('supports unversioned changes only after synchronizing the affected files', async () => {
  await fixture(async ({ root, file, settings }) => {
    await writeFile(file, 'const value = 1'); await writeFile(join(root, 'other.ts'), 'console.log(value)')
    const session = new OrchestratorSession({ projectRoot: root, settings, logFile: null, snapshotFile: null })
    try {
      const result = JSON.parse(await Lsp.execute({ operation: 'rename_preview', path: file, line: 1, character: 7, new_name: 'renamed' }, session.toolContext()))
      expect(result.result.files).toHaveLength(2)
      expect(result.result.files.every((target: any) => target.documentVersion > 0)).toBe(true)
    } finally { await session.shutdown() }
  }, 'rename-changes')
})

it('rejects stale versions, unsafe targets, resource operations and annotations without partial edits', async () => {
  for (const mode of ['rename-stale', 'rename-outside', 'rename-resource', 'rename-annotated', 'rename-null', 'rename-utf8', 'rename-large']) {
    await fixture(async ({ root, file, settings }) => {
      const other = join(root, 'other.ts')
      await writeFile(file, 'const value = 1'); await writeFile(other, 'console.log(value)')
      const session = new OrchestratorSession({ projectRoot: root, settings, logFile: null, snapshotFile: null })
      try {
        await expect(Lsp.execute({ operation: 'rename_preview', path: file, line: 1, character: 7, new_name: 'renamed' }, session.toolContext())).rejects.toThrow()
        expect(await readFile(file, 'utf8')).toBe('const value = 1')
        expect(await readFile(other, 'utf8')).toBe('console.log(value)')
      } finally { await session.shutdown() }
    }, mode)
  }
})


it('reports no-edits separately and refuses application after a preview becomes stale', async () => {
  await fixture(async ({ root, file, settings }) => {
    await writeFile(file, 'const value = 1')
    const session = new OrchestratorSession({ projectRoot: root, settings, logFile: null, snapshotFile: null })
    try {
      const result = JSON.parse(await Lsp.execute({ operation: 'rename_preview', path: file, line: 1, character: 7, new_name: 'renamed' }, session.toolContext()))
      expect(result.result.status).toBe('no-edits')
      expect(result.result.files).toEqual([])
    } finally { await session.shutdown() }
  }, 'rename-noedit')
  await fixture(async ({ root, file, settings }) => {
    const { EditFile } = await import('../src/tools/EditFile/EditFile.js')
    await writeFile(file, 'const value = 1'); await writeFile(join(root, 'other.ts'), 'console.log(value)')
    const session = new OrchestratorSession({ projectRoot: root, settings, logFile: null, snapshotFile: null })
    try {
      const result = JSON.parse(await Lsp.execute({ operation: 'rename_preview', path: file, line: 1, character: 7, new_name: 'renamed' }, session.toolContext()))
      const proposal = result.result.files.find((target: any) => target.arguments.path === file)
      await writeFile(file, 'const value = 2')
      await expect(EditFile.execute(proposal.arguments, session.toolContext())).rejects.toThrow('changed')
      expect(await readFile(file, 'utf8')).toBe('const value = 2')
    } finally { await session.shutdown() }
  }, 'rename-normal')
})


it('refuses unstable or oversized rename previews instead of omitting affected edits', async () => {
  await fixture(async ({ root, file, settings, events }) => {
    await writeFile(file, 'const value = 1')
    for (let index = 1; index <= 3; index++) await writeFile(join(root, `other-${index}.ts`), 'console.log(value)')
    const session = new OrchestratorSession({ projectRoot: root, settings, logFile: null, snapshotFile: null })
    try {
      await expect(Lsp.execute({ operation: 'rename_preview', path: file, line: 1, character: 7, new_name: 'renamed' }, session.toolContext())).rejects.toThrow('scope did not stabilize')
      expect((await events()).filter((event: any) => event.method === 'textDocument/rename')).toHaveLength(3)
      expect(await readFile(file, 'utf8')).toBe('const value = 1')
    } finally { await session.shutdown() }
  }, 'rename-unstable')
  await fixture(async ({ root, file, settings }) => {
    const source = 'value '.repeat(200); await writeFile(file, source)
    const session = new OrchestratorSession({ projectRoot: root, settings, logFile: null, snapshotFile: null })
    try {
      await expect(Lsp.execute({ operation: 'rename_preview', path: file, line: 1, character: 1, new_name: 'x'.repeat(256) }, session.toolContext())).rejects.toThrow('output budget')
      expect(await readFile(file, 'utf8')).toBe(source)
    } finally { await session.shutdown() }
  }, 'rename-budget')
})

it('refuses target changes made while the synchronized rename response is pending', async () => {
  await fixture(async ({ root, file, settings, events }) => {
    const other = join(root, 'other.ts')
    await writeFile(file, 'const value = 1'); await writeFile(other, 'console.log(value)')
    const session = new OrchestratorSession({ projectRoot: root, settings, logFile: null, snapshotFile: null })
    const pending = Lsp.execute({ operation: 'rename_preview', path: file, line: 1, character: 7, new_name: 'renamed' }, session.toolContext())
    const observed = pending.catch((error: unknown) => error)
    try {
      let ready = false
      for (let attempt = 0; attempt < 100; attempt++) {
        ready = await events().then((log: any[]) => log.filter(event => event.method === 'textDocument/rename').length >= 2, () => false)
        if (ready) break
        await new Promise(resolve => setTimeout(resolve, 5))
      }
      expect(ready).toBe(true)
      await writeFile(other, 'console.log(changed)')
      await writeFile(join(root, 'server.jsonl.rename-release'), 'release')
      await expect(pending).rejects.toThrow('changed during the query')
      expect(await readFile(file, 'utf8')).toBe('const value = 1')
      expect(await readFile(other, 'utf8')).toBe('console.log(changed)')
    } finally { await session.shutdown(); await observed }
  }, 'rename-gate')
})


it('snapshots and forwards user initialization options and invalidates changed configuration', async () => {
  await fixture(async ({ root, file, owner, settings, request, events }) => {
    const initializationOptions = { feature: { mode: 'semantic' } }
    settings.lsp.servers[0].initializationOptions = initializationOptions
    const pending = runLspRequest(settings, { operation: 'hover', workspacePath: root, filePath: file, fileContent: await readFile(file, 'utf8'), line: 1, character: 1 }, { owner })
    initializationOptions.feature.mode = 'changed'
    const first = await pending
    const initialized = (await events()).find((event: any) => event.method === 'initialize')
    expect(initialized.params.initializationOptions).toEqual({ feature: { mode: 'semantic' } })
    const second = await request()
    expect(second.generation).not.toBe(first.generation)
    expect(second.configuration).not.toBe(first.configuration)
    expect((await events()).filter((event: any) => event.method === 'initialize').at(-1).params.initializationOptions).toEqual({ feature: { mode: 'changed' } })
  })
})

it('refuses invalid or oversized initialization options before starting a server', async () => {
  await fixture(async ({ settings, request, events }) => {
    settings.lsp.servers[0].initializationOptions = []
    await expect(request()).rejects.toThrow('initializationOptions')
    settings.lsp.servers[0].initializationOptions = { data: 'x'.repeat(65_536) }
    await expect(request()).rejects.toThrow('initializationOptions')
    expect(await events().then(() => true, () => false)).toBe(false)
  })
})
