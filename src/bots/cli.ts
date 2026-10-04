import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { BotStore } from './store.js'
import { serveBots } from './service.js'
import { procedureSkill } from './procedures.js'
import { installPodsHost } from './host.js'

const HELP = `DeepSeek Pods

deepseek pods create NAME --project PATH --instructions TEXT [--agent CONFIG --reviewer-model MODEL]
deepseek pods list
deepseek pods export POD
deepseek pods delete POD --confirm NAME_OR_ID
deepseek pods retention POD [--days 30|90|180|365|730|never]
deepseek pods reviewer-model POD [--model MODEL|inherit]
deepseek pods delivery add POD https://receiver.example/hook --topics run.completed,run.failed
deepseek pods delivery list POD
deepseek pods delivery disable|enable|remove POD TARGET_ID
deepseek pods delivery retry POD DELIVERY_ID
deepseek pods send POD MESSAGE [--occurrence ID]
deepseek pods steer RUN MESSAGE [--occurrence MESSAGE_ID]
deepseek pods show POD
deepseek pods notes POD
deepseek pods remember POD TEXT --source REFERENCE [--expires-at EPOCH_MS]
deepseek pods update-note POD NOTE TEXT --source REFERENCE --version NUMBER [--expires-at EPOCH_MS]
deepseek pods forget POD NOTE --version NUMBER
deepseek pods events POD [--after SEQUENCE]
deepseek pods enable|disable POD
deepseek pods cancel RUN
deepseek pods retry RUN [--reconciled]
deepseek pods reconcile RUN --evidence TEXT
deepseek pods runtime RUN
deepseek pods reset-runtime RUN --evidence TEXT
deepseek pods answer DECISION --fingerprint HASH --answer JSON
deepseek pods learn POD --run RUN --name SKILL_NAME
deepseek pods procedures POD
deepseek pods skill POD PROCEDURE_ID
deepseek pods routine POD --name NAME --prompt TEXT --schedule JSON [--procedure ID --inputs JSON]
deepseek pods routines POD
deepseek pods disable-routine POD ROUTINE
deepseek pods run-routine POD ROUTINE [--occurrence ID]
deepseek pods test-routine POD ROUTINE [--occurrence ID]
deepseek pods routine-runs POD ROUTINE
deepseek pods delete-routine POD ROUTINE --version N
deepseek pods event TOPIC EVENT_ID --payload JSON
deepseek pods serve [--concurrency 2] [--web --host 127.0.0.1 --port 8787]
  [--public-url https://pods.example.com]
deepseek pods host install USER@HOST [--identity SSH_KEY] [--ssh-port 22]
deepseek pods history POD QUERY [--limit 1-20]
deepseek pods groups
deepseek pods group create NAME --members POD_ID,POD_ID [--share-browser]
deepseek pods group show GROUP_ID
deepseek pods group send GROUP_ID MESSAGE [--recipients POD_ID,POD_ID] [--occurrence ID]
deepseek pods group artifacts GROUP_ID
deepseek pods group artifact GROUP_ID NAME
deepseek pods group delete GROUP_ID --confirm NAME_OR_ID

All commands accept --db PATH. Run serve under systemd for work that survives
closing your terminal. Permission answers are "once" or "deny"; question answers
are a JSON string map. Cancelling a run does not disable its routine.
The panel requires DEEPSEEK_BOTS_TOKEN (at least 32 random characters).
Remote access requires an HTTPS reverse proxy and --public-url.
host install deploys to a Debian/Ubuntu server you already own over SSH; it does not create a cloud VM.
`

export async function runPodsCli(args: string[]): Promise<void> {
  const options = new Map<string, string>(), positionals: string[] = []
  const flags = new Set(['reconciled', 'help', 'web', 'share-browser'])
  const known = new Set(['db', 'project', 'instructions', 'agent', 'reviewer-model', 'model', 'occurrence', 'after', 'fingerprint', 'answer', 'name', 'prompt', 'schedule', 'payload', 'concurrency', 'evidence', 'host', 'port', 'public-url', 'run', 'procedure', 'inputs', 'source', 'expires-at', 'version', 'confirm', 'days', 'topics', 'members', 'recipients', 'limit', 'identity', 'ssh-port'])
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (!arg.startsWith('--')) { positionals.push(arg); continue }
    const name = arg.slice(2)
    if (options.has(name)) throw new Error(`Duplicate option --${name}`)
    if (flags.has(name)) { options.set(name, 'true'); continue }
    if (!known.has(name)) throw new Error(`Unknown option --${name}`)
    const value = args[++i]
    if (value === undefined || value.startsWith('--')) throw new Error(`--${name} requires a value`)
    options.set(name, value)
  }
  const [command, id, ...rest] = positionals
  if (!command || command === 'help' || options.has('help')) { console.log(HELP); return }
  const path = options.has('db') ? resolve(options.get('db')!) : undefined
  const required = (name: string) => {
    const value = options.get(name)
    if (!value) throw new Error(`--${name} is required`)
    return value
  }
  const identifier = () => { if (!id) throw new Error('An identifier is required'); return id }
  if (command === 'host') {
    const action = identifier()
    if (action !== 'install') throw new Error('Host action must be install')
    const target = rest[0]
    if (!target) throw new Error('SSH target is required (USER@HOST or an SSH config alias)')
    if (rest.length > 1) throw new Error('Host installation accepts one SSH target.')
    const sshPort = options.has('ssh-port') ? Number(required('ssh-port')) : undefined
    await installPodsHost({ target, identityFile: options.get('identity'), sshPort })
    return
  }
  if (command === 'serve') {
    if (!options.has('web') && ['host', 'port', 'public-url'].some(key => options.has(key))) throw new Error('Panel options require --web')
    const controller = new AbortController(), stop = () => controller.abort()
    process.on('SIGINT', stop); process.on('SIGTERM', stop)
    console.log('DeepSeek Pods service running. Queued work and routines are active. Ctrl+C stops the service.')
    try { await serveBots({ path, concurrency: options.has('concurrency') ? Number(required('concurrency')) : undefined, signal: controller.signal,
      web: options.has('web') ? { hostname: options.get('host'), port: options.has('port') ? Number(required('port')) : undefined, publicUrl: options.get('public-url') } : undefined,
      onWebListening: url => console.log(`Pods panel: ${url}`),
    }) }
    finally { process.off('SIGINT', stop); process.off('SIGTERM', stop) }
    return
  }
  const store = await BotStore.open({ path })
  let result: unknown
  try {
    switch (command) {
      case 'create': result = store.createBot({ name: identifier(), projectRoot: required('project'), instructions: required('instructions'), agentConfig: options.get('agent'), reviewerModel: options.get('reviewer-model') }); break
      case 'list': result = store.listBots(); break
      case 'history': result = store.searchHistory(identifier(), rest.join(' '), options.has('limit') ? Number(required('limit')) : 10); break
      case 'groups': result = store.listGroups(); break
      case 'group': {
        const action = id, groupId = rest[0]
        if (action === 'create') {
          const name = groupId
          if (!name) throw new Error('Group name is required')
          const members = required('members').split(',').map(value => value.trim()).filter(Boolean)
          result = store.createGroup({ name, botIds: members, shareBrowser: options.has('share-browser') })
        } else {
          if (!groupId) throw new Error('Group ID is required')
          if (action === 'show') result = { group: store.getGroup(groupId), messages: store.groupMessages(groupId), artifacts: store.groupArtifactsForUser(groupId), runs: store.groupRuns(groupId).map(({ id, botId, status, attempt, updatedAt, error }) => ({ id, botId, status, attempt, updatedAt, error })) }
          else if (action === 'send') result = store.sendGroupMessage(groupId, rest.slice(1).join(' '), options.get('occurrence') ?? crypto.randomUUID(), options.has('recipients') ? required('recipients').split(',').map(value => value.trim()).filter(Boolean) : undefined)
          else if (action === 'artifacts') result = store.groupArtifactsForUser(groupId)
          else if (action === 'artifact') {
            if (!rest[1]) throw new Error('Artifact name is required')
            result = store.readGroupArtifactForUser(groupId, rest[1])
          } else if (action === 'delete') result = await store.deleteGroup(groupId, required('confirm'))
          else throw new Error('Group action must be create, show, send, artifacts, artifact or delete')
        }
        break
      }
      case 'export': result = store.exportBot(identifier()); break
      case 'delete': result = await store.deleteBot(identifier(), required('confirm')); break
      case 'retention': result = options.has('days') ? store.setRetentionDays(identifier(), required('days') === 'never' ? null : Number(required('days'))) : { retentionDays: store.getBot(identifier()).retentionDays }; break
      case 'reviewer-model': result = options.has('model') ? store.setReviewerModel(identifier(), required('model') === 'inherit' ? null : required('model')) : { reviewerModel: store.getBot(identifier()).reviewerModel ?? null }; break
      case 'send': result = store.enqueue(identifier(), rest.join(' '), 'user', options.get('occurrence')); break
      case 'steer': result = store.steer(identifier(), rest.join(' '), options.get('occurrence')); break
      case 'show': result = store.conversation(identifier()); break
      case 'notes': result = store.notes(identifier()); break
      case 'remember': result = store.addNote(identifier(), rest.join(' '), required('source'), options.has('expires-at') ? Number(required('expires-at')) : null); break
      case 'update-note': {
        if (!rest[0]) throw new Error('Note ID is required')
        result = store.updateNote(identifier(), rest[0], rest.slice(1).join(' '), required('source'), options.has('expires-at') ? Number(required('expires-at')) : null, Number(required('version'))); break
      }
      case 'forget': {
        if (!rest[0]) throw new Error('Note ID is required')
        result = { removed: store.removeNote(identifier(), rest[0], Number(required('version'))) }; break
      }
      case 'events': {
        const after = options.has('after') ? Number(required('after')) : 0
        if (!Number.isSafeInteger(after) || after < 0) throw new Error('--after must be a nonnegative sequence')
        result = store.events(store.getBot(identifier()).id).query({ after_seq: after }); break
      }
      case 'enable': case 'disable': store.setEnabled(identifier(), command === 'enable'); result = store.getBot(identifier()); break
      case 'cancel': store.cancel(identifier()); result = store.getRun(identifier()); break
      case 'retry': store.retry(identifier(), options.has('reconciled')); result = store.getRun(identifier()); break
      case 'reconcile': store.reconcile(identifier(), required('evidence')); result = store.getRun(identifier()); break
      case 'runtime': result = store.inspectRuntime(identifier()); break
      case 'reset-runtime': store.resetLegacyRuntime(identifier(), required('evidence')); result = store.inspectRuntime(identifier()); break
      case 'answer': store.answerDecision(identifier(), required('fingerprint'), JSON.parse(required('answer'))); result = store.getDecision(identifier()); break
      case 'learn': result = store.learnProcedure(identifier(), required('run'), required('name')); break
      case 'procedures': result = store.procedures(identifier()); break
      case 'skill': if (!rest[0]) throw new Error('Procedure ID is required'); console.log(procedureSkill(store.getProcedure(identifier(), rest[0]))); return
      case 'routine': result = store.addRoutine(identifier(), { name: required('name'), prompt: required('prompt'), schedule: JSON.parse(required('schedule')), procedureId: options.get('procedure'), procedureInputs: options.has('inputs') ? JSON.parse(required('inputs')) : undefined }); break
      case 'routines': result = store.routines(identifier()); break
      case 'disable-routine': {
        const routine = rest[0]
        if (!store.routines(identifier()).some(r => r.id === routine)) throw new Error('Routine does not belong to this bot')
        store.setRoutineEnabled(routine!, false); result = store.routines(identifier()); break
      }
      case 'run-routine': {
        if (!rest[0]) throw new Error('Routine ID is required')
        result = store.runRoutineNow(identifier(), rest[0], options.get('occurrence')); break
      }
      case 'test-routine': {
        if (!rest[0]) throw new Error('Routine ID is required')
        result = store.testRoutineNow(identifier(), rest[0], options.get('occurrence')); break
      }
      case 'delivery': {
        const action = id, botId = rest[0]
        if (!botId) throw new Error('A bot name or ID is required')
        if (action === 'list') result = { targets: store.deliveryTargets(botId), history: store.deliveryHistory(botId) }
        else if (action === 'add') {
          const url = rest[1]
          if (!url) throw new Error('A public HTTPS receiver URL is required')
          const topics = required('topics').split(',').map(topic => topic.trim()).filter(Boolean)
          const target = await store.addDeliveryTarget(botId, url, topics)
          result = { ...target, verification: 'Verify X-DeepSeek-Delivery-Signature using this Ed25519 public key. The signed bytes are timestamp + "." + the exact JSON body.' }
        } else {
          const targetId = rest[1]
          if (!targetId) throw new Error('A delivery target ID is required')
          if (action === 'remove') result = { removed: await store.deleteDeliveryTarget(botId, targetId) }
          else if (action === 'retry') {
            const { body: _body, ...record } = store.retryDelivery(botId, targetId)
            result = record
          }
          else if (action === 'disable' || action === 'enable') result = store.setDeliveryTargetEnabled(botId, targetId, action === 'enable')
          else throw new Error('Delivery action must be add, list, enable, disable, remove or retry')
        }
        break
      }
      case 'routine-runs': {
        if (!rest[0]) throw new Error('Routine ID is required')
        result = store.routineRuns(identifier(), rest[0]); break
      }
      case 'delete-routine': {
        if (!rest[0]) throw new Error('Routine ID is required')
        result = { deleted: store.deleteRoutine(identifier(), rest[0], Number(required('version'))) }; break
      }
      case 'event': {
        if (!rest[0]) throw new Error('Event ID is required')
        result = store.dispatchEvent(identifier(), rest[0], JSON.parse(required('payload'))); break
      }
      default: throw new Error(`Unknown Pods command '${command}'. Use deepseek pods help.`)
    }
    console.log(JSON.stringify(result, null, 2))
  } finally { store.close() }
}
