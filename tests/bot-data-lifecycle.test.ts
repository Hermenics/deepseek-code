import { afterEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { BotStore } from '../src/bots/store.js'

const stores: BotStore[] = [], directories: string[] = []
function open(path: string) { const store = new BotStore({ path }); stores.push(store); return store }
function temporary() { const directory = mkdtempSync(join(tmpdir(), 'deepseek-bot-data-')); directories.push(directory); return directory }
function bot(store: BotStore, name = 'engineer') { return store.createBot({ name, projectRoot: process.cwd(), instructions: 'Maintain this project and report observed results.' }) }
afterEach(() => { for (const store of stores.splice(0)) store.close(); for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })

describe('persistent bot data lifecycle', () => {
  it('exports durable bot and Agent session data without webhook verifiers', () => {
    const directory = temporary(), store = open(join(directory, 'state.db')), selected = bot(store)
    const run = store.enqueue(selected.id, 'Inspect this project')
    store.addNote(selected.id, 'Use the existing project conventions.', 'user:confirmed')
    store.addRoutine(selected.id, { name: 'Daily check', prompt: 'Check current sources.', schedule: { kind: 'daily', hour: 8, minute: 0, timeZone: 'America/Fortaleza' } })
    const previewRoutine = store.routines(selected.id)[0]!
    const preview = store.testRoutineNow(selected.id, previewRoutine.id, 'export-preview')
    const hook = store.rotateWebhookCredential(selected.id, 'issues.opened')
    store.dispatchEvent('issues.opened', 'event-1', { title: 'Current issue' }, selected.id)
    store.store.run('INSERT INTO sessions (id,cwd,model,provider,created_at,updated_at) VALUES (?,?,?,?,?,?)', `bot:${selected.id}`, selected.projectRoot, 'test-model', 'test-provider', new Date().toISOString(), new Date().toISOString())
    store.store.run("INSERT INTO tasks (task_id,session_id,type,mode,state,permission_profile,timeout_ms,created_at) VALUES (?,?,?,'foreground','done','researcher-readonly',1000,?)", 'task-export', `bot:${selected.id}`, 'agent', new Date().toISOString())
    const runSession = `bot:${selected.id}:run:${run.id}`
    store.store.run('INSERT INTO sessions (id,cwd,model,provider,created_at,updated_at) VALUES (?,?,?,?,?,?)', runSession, selected.projectRoot, 'test-model', 'test-provider', new Date().toISOString(), new Date().toISOString())
    store.store.run("INSERT INTO tasks (task_id,session_id,type,mode,state,permission_profile,timeout_ms,created_at) VALUES (?,?,?,'foreground','done','researcher-readonly',1000,?)", 'task-export-run', runSession, 'agent', new Date().toISOString())
    store.events(runSession).emit('RunScopedPrivateState', { private: 'production run session event' })
    const previewSession = `bot:${selected.id}:test:${preview.id}`
    store.store.run('INSERT INTO sessions (id,cwd,model,provider,created_at,updated_at) VALUES (?,?,?,?,?,?)', previewSession, selected.projectRoot, 'test-model', 'test-provider', new Date().toISOString(), new Date().toISOString())
    store.store.run("INSERT INTO tasks (task_id,session_id,type,mode,state,permission_profile,timeout_ms,created_at) VALUES (?,?,?,'foreground','done','researcher-readonly',1000,?)", 'task-export-preview', previewSession, 'agent', new Date().toISOString())
    store.events(previewSession).emit('PreviewPrivateState', { private: 'test session event' })

    const exported = store.exportBot(selected.id)
    const serialized = JSON.stringify(exported)
    expect(exported).toMatchObject({ schemaVersion: 1, bot: { id: selected.id, name: selected.name }, excluded: expect.arrayContaining(['Codimium browser cookies and profile']) })
    expect((exported.runs as Array<{ id: string }>).map(item => item.id)).toContain(run.id)
    expect((exported.runs as Array<{ id: string; testMode: boolean }>).find(item => item.id === preview.id)?.testMode).toBe(true)
    expect((exported.agentSession as { sessions: Array<{ id: string }> }).sessions.map(item => item.id)).toContain(previewSession)
    expect((exported.agentSession as { sessions: Array<{ id: string }> }).sessions.map(item => item.id)).toContain(runSession)
    expect((exported.agentSession as { tasks: Array<{ task_id: string }> }).tasks.map(item => item.task_id)).toEqual(expect.arrayContaining(['task-export', 'task-export-run', 'task-export-preview']))
    expect(serialized).toContain('test session event')
    expect(serialized).toContain('production run session event')
    expect(serialized).toContain('issues.opened')
    expect(serialized).not.toContain(hook.secret)
    expect(serialized).not.toContain(store.store.query<{ secret_hash: string }>('SELECT secret_hash FROM bot_webhook_credentials WHERE bot_id=?', selected.id)[0]!.secret_hash)
  })

  it('refuses deletion until owners stop and uncertain effects are reconciled, then removes bot rows and actor files', async () => {
    const directory = temporary(), path = join(directory, 'state.db'), store = open(path), selected = bot(store)
    const run = store.enqueue(selected.id, 'Make a project change')
    store.claim(selected.id, 'worker')
    await expect(store.deleteBot(selected.id, selected.name)).rejects.toThrow('Stop the bot')
    store.beginAction(run.id, 'worker', 'write_file', { path: 'result.txt' }, false)
    store.cancel(run.id); store.acknowledgeStop(run.id, 'worker')
    await expect(store.deleteBot(selected.id, selected.id)).rejects.toThrow('Reconcile every uncertain effect')
    await expect(store.deleteBot(selected.id, 'wrong confirmation')).rejects.toThrow('exact bot name or ID')
    store.reconcile(run.id, 'Inspected the workspace and confirmed the intended file change.')
    const actor = join(dirname(path), 'actors', selected.id)
    mkdirSync(actor, { recursive: true }); writeFileSync(join(actor, 'private.txt'), 'private state')
    store.addNote(selected.id, 'A private saved note.', 'user:confirmed')
    store.addRoutine(selected.id, { name: 'Routine', prompt: 'Check.', schedule: { kind: 'event', topic: 'event' } })
    const sessionId = `bot:${selected.id}`, timestamp = new Date().toISOString()
    const previewSession = `${sessionId}:test:run-delete`
    const runSession = `${sessionId}:run:${run.id}`
    store.store.run('INSERT INTO sessions (id,cwd,model,provider,created_at,updated_at) VALUES (?,?,?,?,?,?)', sessionId, selected.projectRoot, 'test-model', 'test-provider', timestamp, timestamp)
    store.store.run('INSERT INTO sessions (id,cwd,model,provider,created_at,updated_at) VALUES (?,?,?,?,?,?)', runSession, selected.projectRoot, 'test-model', 'test-provider', timestamp, timestamp)
    store.store.run('INSERT INTO sessions (id,cwd,model,provider,created_at,updated_at) VALUES (?,?,?,?,?,?)', previewSession, selected.projectRoot, 'test-model', 'test-provider', timestamp, timestamp)
    store.store.run("INSERT INTO tasks (task_id,session_id,type,mode,state,permission_profile,timeout_ms,created_at) VALUES (?,?,?,'foreground','blocked','researcher-readonly',1000,?)", 'pending-test-task', previewSession, 'agent', timestamp)
    await expect(store.deleteBot(selected.id, selected.name)).rejects.toThrow('Resolve or cancel delegated work')
    store.store.run("UPDATE tasks SET state='done' WHERE task_id='pending-test-task'")
    store.store.run('INSERT INTO threads (id,session_id,created_at,updated_at) VALUES (?,?,?,?)', 'thread-delete', sessionId, timestamp, timestamp)
    store.store.run('INSERT INTO turns (id,thread_id,sequence,model,provider) VALUES (?,?,?,?,?)', 'turn-delete', 'thread-delete', 1, 'test-model', 'test-provider')
    store.store.run('INSERT INTO tool_calls (id,turn_id,tool_name,tool_input) VALUES (?,?,?,?)', 'call-delete', 'turn-delete', 'read_file', '{}')
    store.store.run('INSERT INTO goals (goal_id,thread_id,session_id,objective,started_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?)', 'goal-delete', 'thread-delete', sessionId, 'Task objective', timestamp, timestamp, timestamp)
    store.store.run('INSERT INTO goal_criteria (id,goal_id,sequence,spec) VALUES (?,?,?,?)', 'criterion-delete', 'goal-delete', 1, 'Check')
    store.store.run("INSERT INTO tasks (task_id,session_id,type,mode,state,permission_profile,timeout_ms,created_at) VALUES (?,?,?,'foreground','done','researcher-readonly',1000,?)", 'task-delete', sessionId, 'agent', timestamp)
    store.store.run('INSERT INTO threads (id,session_id,created_at,updated_at) VALUES (?,?,?,?)', 'thread-test-delete', previewSession, timestamp, timestamp)
    store.store.run('INSERT INTO turns (id,thread_id,sequence,model,provider) VALUES (?,?,?,?,?)', 'turn-test-delete', 'thread-test-delete', 1, 'test-model', 'test-provider')
    store.store.run('INSERT INTO tool_calls (id,turn_id,tool_name,tool_input) VALUES (?,?,?,?)', 'call-test-delete', 'turn-test-delete', 'write_file', '{}')
    store.store.run("INSERT INTO tasks (task_id,session_id,type,mode,state,permission_profile,timeout_ms,created_at) VALUES (?,?,?,'foreground','done','researcher-readonly',1000,?)", 'task-test-delete', previewSession, 'agent', timestamp)
    store.store.run('INSERT INTO path_claims (task_id,paths,acquired_at) VALUES (?,?,?)', 'task-delete', '[]', timestamp)
    store.store.run('INSERT INTO integration_results (integration_id,task_id,status,started_at) VALUES (?,?,?,?)', 'integration-delete', 'task-delete', 'done', timestamp)
    store.store.run('INSERT INTO workflow_runs (run_id,workflow_name,workflow_version,status,task_ids,session_id,started_at) VALUES (?,?,?,?,?,?,?)', 'workflow-delete', 'fixture', 1, 'done', '[]', sessionId, timestamp)
    store.events(sessionId).emit('TaskPrivateState', { private: true })
    const result = await store.deleteBot(selected.id, selected.name)
    expect(result).toEqual({ deleted: true, filesRemoved: true })
    expect(existsSync(actor)).toBe(false)
    expect(store.listBots()).toEqual([])
    expect(store.store.query('SELECT id FROM bot_instances WHERE id=?', selected.id)).toEqual([])
    expect(store.store.query('SELECT id FROM bot_runs WHERE bot_id=?', selected.id)).toEqual([])
    expect(store.store.query('SELECT id FROM bot_notes WHERE bot_id=?', selected.id)).toEqual([])
    for (const [table, column, value] of [
      ['sessions', 'id', sessionId], ['sessions', 'id', runSession], ['sessions', 'id', previewSession], ['threads', 'id', 'thread-delete'], ['threads', 'id', 'thread-test-delete'], ['turns', 'id', 'turn-delete'], ['turns', 'id', 'turn-test-delete'], ['tool_calls', 'id', 'call-delete'], ['tool_calls', 'id', 'call-test-delete'],
      ['goals', 'goal_id', 'goal-delete'], ['goal_criteria', 'id', 'criterion-delete'], ['tasks', 'task_id', 'task-delete'], ['tasks', 'task_id', 'task-test-delete'], ['tasks', 'task_id', 'pending-test-task'],
      ['path_claims', 'task_id', 'task-delete'], ['integration_results', 'integration_id', 'integration-delete'], ['workflow_runs', 'run_id', 'workflow-delete'],
    ]) expect(store.store.query(`SELECT 1 FROM ${table} WHERE ${column}=?`, value)).toEqual([])
    expect(store.events(sessionId).query()).toEqual([])
    expect(store.events(previewSession).query()).toEqual([])
  })

  it('stages deletion safely when the actor directory is redirected and resumes after the path is repaired', async () => {
    const directory = temporary(), path = join(directory, 'state.db'), store = open(path), selected = bot(store)
    const actorRoot = join(directory, 'actors'), external = join(directory, 'external')
    mkdirSync(external); writeFileSync(join(external, 'keep.txt'), 'must remain')
    symlinkSync(external, actorRoot, 'dir')
    await expect(store.deleteBot(selected.id, selected.name)).rejects.toThrow('Refusing to remove bot data through a non-directory actors path')
    expect(store.listBots()).toEqual([])
    expect(store.store.query<{ enabled: number; deleting: number }>('SELECT enabled,deleting FROM bot_instances WHERE id=?', selected.id)[0]).toEqual({ enabled: 0, deleting: 1 })
    expect(existsSync(join(external, 'keep.txt'))).toBe(true)
    rmSync(actorRoot)
    expect(await store.deleteBot(selected.id, selected.name)).toMatchObject({ deleted: true })
    expect(existsSync(join(external, 'keep.txt'))).toBe(true)
  })

  it('automatically expires terminal run data while protecting active, uncertain and skill-source history', async () => {
    const directory = temporary(), path = join(directory, 'state.db'), store = open(path), selected = bot(store)
    const old = new Date(Date.now() - 31 * 86_400_000).toISOString()
    const completed = store.enqueue(selected.id, 'Expired completed run')
    store.claim(selected.id, 'retention-worker')
    store.finish(completed.id, 'retention-worker', 'completed', 'Private completed output')
    store.acknowledgeStop(completed.id, 'retention-worker')
    store.store.run('UPDATE bot_runs SET updated_at=? WHERE id=?', old, completed.id)
    const completedSession = `bot:${selected.id}:run:${completed.id}`
    store.store.run('INSERT INTO sessions (id,cwd,model,provider,created_at,updated_at) VALUES (?,?,?,?,?,?)', completedSession, selected.projectRoot, 'test-model', 'test-provider', old, old)
    store.store.run("INSERT INTO tasks (task_id,session_id,type,mode,state,permission_profile,timeout_ms,created_at) VALUES (?,?,?,'foreground','done','researcher-readonly',1000,?)", 'retention-task', completedSession, 'agent', old)
    const actor = join(directory, 'actors', selected.id), runData = join(actor, 'runs', completed.id), browserProfile = join(actor, 'codimium')
    mkdirSync(runData, { recursive: true }); mkdirSync(browserProfile, { recursive: true })
    writeFileSync(join(runData, 'private.json'), 'private run state')
    writeFileSync(join(browserProfile, 'cookie-state'), 'persistent login')
    store.events(selected.id).emit('ExpiredRunAudit', { runId: completed.id, private: true })
    store.store.run("UPDATE events SET created_at=? WHERE session_id=? AND type='ExpiredRunAudit'", old, selected.id)

    const source = store.enqueue(selected.id, 'History retained by learned skill')
    store.claim(selected.id, 'skill-source-worker')
    store.finish(source.id, 'skill-source-worker', 'completed', 'skill source')
    store.acknowledgeStop(source.id, 'skill-source-worker')
    store.store.run('UPDATE bot_runs SET updated_at=? WHERE id=?', old, source.id)
    store.store.run('INSERT INTO bot_procedures (id,bot_id,name,source_run_id,steps,created_at) VALUES (?,?,?,?,?,?)', 'retained-skill', selected.id, 'retained-skill', source.id, '[]', old)

    const uncertain = store.enqueue(selected.id, 'Uncertain side effect')
    store.claim(selected.id, 'uncertain-worker')
    store.beginAction(uncertain.id, 'uncertain-worker', 'write_file', { path: 'result.txt' }, false)
    store.cancel(uncertain.id); store.acknowledgeStop(uncertain.id, 'uncertain-worker')
    store.store.run('UPDATE bot_runs SET updated_at=? WHERE id=?', old, uncertain.id)
    const noPolicyBot = bot(store, 'long-retention')
    const noPolicyRun = store.enqueue(noPolicyBot.id, 'No retention configured')
    store.store.run('UPDATE bot_runs SET status=\'completed\',owner=NULL,updated_at=? WHERE id=?', old, noPolicyRun.id)
    store.dispatchEvent('unmatched.retention', 'expired-receipt', { harmless: true }, selected.id)
    store.store.run('UPDATE bot_event_receipts SET created_at=? WHERE scope_id=? AND event_id=?', old, selected.id, 'expired-receipt')
    store.setRetentionDays(selected.id, 30)

    const result = await store.applyDataRetention(Date.now())
    expect(result.runsDeleted).toBe(1)
    expect(result.receiptsDeleted).toBe(1)
    expect(result.failures).toBe(0)
    expect(() => store.getRun(completed.id)).toThrow('not found')
    expect(existsSync(runData)).toBe(false)
    expect(existsSync(join(browserProfile, 'cookie-state'))).toBe(true)
    expect(store.store.query('SELECT id FROM sessions WHERE id=?', completedSession)).toEqual([])
    expect(store.store.query('SELECT task_id FROM tasks WHERE task_id=\'retention-task\'')).toEqual([])
    expect(store.store.query('SELECT id FROM bot_runs WHERE id IN (?,?)', source.id, uncertain.id)).toHaveLength(2)
    expect(store.getRun(noPolicyRun.id).status).toBe('completed')
    expect(store.store.query('SELECT event_id FROM bot_event_receipts WHERE event_id=\'expired-receipt\'')).toEqual([])
    expect(store.store.query("SELECT event_id FROM events WHERE type='ExpiredRunAudit'")).toEqual([])
  })
})
