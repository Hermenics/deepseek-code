import { COMMAND_DESCRIPTIONS, COMMAND_SUGGESTIONS } from '../commands/index.js'

const WEB_COMMAND_SUGGESTIONS = JSON.stringify(COMMAND_SUGGESTIONS)
const WEB_COMMAND_DESCRIPTIONS = JSON.stringify(COMMAND_DESCRIPTIONS)

export const CLIENT_APP = String.raw`(() => {
  const COMMAND_SUGGESTIONS = ${WEB_COMMAND_SUGGESTIONS};
  const COMMAND_DESCRIPTIONS = ${WEB_COMMAND_DESCRIPTIONS};
  const $ = (selector, parent = document) => parent.querySelector(selector);
  const make = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
  const icon = (path) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + path + '"/></svg>';
  const deepseekLogo = '<img class="deepseek-logo" data-logo alt="">';
  const icons = { chat: icon('M20 15a4 4 0 0 1-4 4H8l-4 3v-7a4 4 0 0 1-1-3V8a4 4 0 0 1 4-4h9a4 4 0 0 1 4 4z'), changes: icon('M4 4h16v16H4z M8 8h8 M8 12h5 M8 16h8'), terminal: icon('M5 6l5 5-5 5 M12 18h7'), refresh: icon('M20 11a8 8 0 1 0 2 5 M20 4v7h-7'), theme: icon('M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5 8.5 8.5 0 1 0 20.5 14.5z'), sun: icon('M12 3v2 M12 19v2 M4.2 4.2l1.4 1.4 M18.4 18.4l1.4 1.4 M3 12h2 M19 12h2 M4.2 19.8l1.4-1.4 M18.4 5.6l1.4-1.4 M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0z'), send: icon('M21 3L9 15 M21 3l-6 18-4-6-6-4z'), stop: icon('M6 6h12v12H6z'), folder: icon('M3 7h7l2 2h9v10H3z'), branch: icon('M6 3v12 M18 9V3 M6 7h12 M6 18a2 2 0 1 0 0-4 2 2 0 0 0 0 4z M18 5a2 2 0 1 0 0-4 2 2 0 0 0 0 4z M18 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4z'), clear: icon('M4 7h16 M9 7V4h6v3 M7 7l1 13h8l1-13'), plus: icon('M12 5v14 M5 12h14') };
  const modes = ['build', 'plan', 'review', 'auto'];
  const svg = (path, extra) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"' + (extra || '') + '><path d="' + path + '"/></svg>';
  const toolIcons = {
    file: svg('M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z M14 3v5h5'),
    edit: svg('M12 20h9 M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z'),
    bash: svg('M4 17l6-6-6-6 M12 19h8'),
    search: svg('M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z M21 21l-4.3-4.3'),
    globe: svg('M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M3 12h18 M12 3a14 14 0 0 1 0 18 M12 3a14 14 0 0 0 0 18'),
    branch: svg('M6 3v12 M18 9V3 M6 7h12 M6 18a2 2 0 1 0 0-4 2 2 0 0 0 0 4z M18 5a2 2 0 1 0 0-4 2 2 0 0 0 0 4z M18 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4z'),
    agent: svg('M12 4a5 5 0 1 0 0 10 5 5 0 0 0 0-10z M12 8h.01 M9 14l-2 7 M15 14l2 7 M12 15v6'),
    todo: svg('M9 11l3 3 8-8 M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11'),
    question: svg('M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M9.1 9a3 3 0 1 1 5.8 1c0 2-2.9 2-2.9 4 M12 17h.01'),
    plan: svg('M8 6h13 M8 12h13 M8 18h13 M3.5 6h.01 M3.5 12h.01 M3.5 18h.01'),
    gear: svg('M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5h.1a1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.5 1h.2a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z'),
  };
  const TOOL_META = {
    read_file: ['Read', 'file'], write_file: ['Write', 'edit'], edit_file: ['Edit', 'edit'], patch_file: ['Patch', 'edit'],
    read_folder: ['List', 'file'], glob: ['Glob', 'search'], grep: ['Grep', 'search'], shell: ['Bash', 'bash'],
    git: ['Git', 'branch'], web_fetch: ['WebFetch', 'globe'], subagent: ['Agent', 'agent'], ask_agent: ['AskAgent', 'agent'],
    moa: ['MoA', 'agent'], workflow: ['Workflow', 'agent'], todo: ['TodoWrite', 'todo'], ask_user_questions: ['AskUser', 'question'],
    write_plan: ['Plan', 'plan'], submit_plan: ['SubmitPlan', 'plan'], introspect: ['Introspect', 'file'],
    memory: ['Memory', 'gear'], update_knowledge: ['Knowledge', 'gear'], lsp: ['LSP', 'gear'],
    create_goal: ['Goal', 'gear'], get_goal: ['Goal', 'gear'], update_goal: ['Goal', 'gear'],
  };
  const toolMeta = (name) => { const meta = TOOL_META[name]; return { display: meta ? meta[0] : name, icon: toolIcons[meta ? meta[1] : 'gear'] }; };
  const clip = (value, max) => value.length > max ? value.slice(0, max - 1) + '…' : value;
  const ARG_FIELDS = ['path', 'file_path', 'command', 'pattern', 'query', 'url', 'action', 'task', 'description', 'prompt', 'name'];
  const previewString = (value) => typeof value === 'string' && value.trim() ? clip(value.replace(/\s+/g, ' ').trim(), 72) : null;
  const summarizeArgs = (name, args) => {
    if (!args || typeof args !== 'object') return '';
    if (name === 'grep') { const parts = ['/']; if (args.pattern) parts[0] += String(args.pattern).slice(0, 40) + '/'; if (args.path) parts.push('· ' + args.path); return parts.join(' ').trim(); }
    if (name === 'git') { return [args.command || args.action, args.subcommand, typeof args.args === 'string' ? args.args : ''].filter(Boolean).join(' ').trim(); }
    for (const field of ARG_FIELDS) { const preview = previewString(args[field]); if (preview) return preview; }
    const firstString = Object.values(args).find(previewString); return firstString ? previewString(firstString) : '';
  };
  const summarizeResult = (name, result) => {
    if (name === 'ask_user_questions') return 'questions answered';
    if (name === 'todo') return 'todo list updated';
    const text = String(result || '').replace(/\s+/g, ' ').trim();
    if (!text) return 'done';
    if (text.startsWith('{') || text.startsWith('[')) {
      try { const parsed = JSON.parse(text); if (Array.isArray(parsed)) return parsed.length + ' item' + (parsed.length === 1 ? '' : 's'); if (parsed && typeof parsed === 'object' && typeof parsed.error === 'string') return clip('Error: ' + parsed.error, 72); if (parsed && typeof parsed === 'object' && typeof parsed.path === 'string') return parsed.path; } catch (_) {}
    }
    return clip(text, 72);
  };
  const diffLine = (container, text, kind) => container.append(make('div', 'inline-diff-line ' + kind, text || ' '));
  const renderInlineDiff = (container, kind, oldText, newText) => {
    const wrap = make('div', 'inline-diff');
    if (oldText) String(oldText).split('\n').forEach((line) => diffLine(wrap, line, 'remove'));
    if (newText) String(newText).split('\n').forEach((line) => diffLine(wrap, line, 'add'));
    container.append(wrap);
  };
  const renderPatchDiff = (container, patch) => {
    const wrap = make('div', 'inline-diff');
    String(patch).split('\n').forEach((line) => {
      if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@')) wrap.append(make('div', 'inline-diff-line hunk', line));
      else if (line.startsWith('+')) diffLine(wrap, line.slice(1), 'add');
      else if (line.startsWith('-')) diffLine(wrap, line.slice(1), 'remove');
    });
    container.append(wrap);
  };
  const renderTodoList = (container, items) => {
    const wrap = make('div', 'todo-checklist');
    items.forEach((item) => {
      const mark = item.status === 'done' ? '✓' : item.status === 'in_progress' ? '◐' : '○';
      wrap.append(make('div', 'todo-item ' + item.status, mark + ' ' + (item.title || item.content || '')));
    });
    container.append(wrap);
  };
  const state = { ws: null, connected: false, running: false, reconnect: null, lastEventSeq: 0, lastHeartbeat: 0, mode: 'build', tools: [], source: null, stats: null, todos: [], diffTab: 'working', view: 'chat', activeAssistant: null, activeThinking: null, activity: [], terminalOpened: false, sawTerminalExit: false, terminal: null, terminalResizeObserver: null, modal: null, modalOrigin: null };

  document.getElementById('app').innerHTML = '<a class="skip-link" href="#workspace-main">Skip to workspace</a><div class="shell">' +
    '<aside class="sidebar"><div class="brand"><div class="brand-mark">' + deepseekLogo + '</div><div class="brand-copy"><div class="brand-name">DeepSeek Code</div><div class="brand-tag">WORKSHOP EDITION</div></div></div>' +
    '<div class="project"><div class="project-glyph">' + icons.folder + '</div><div class="project-copy"><div class="project-name" id="project-name">Workspace</div><div class="project-path" id="project-path">Connecting…</div><div class="project-status"><span class="project-status-dot"></span>LOCAL WORKSPACE</div></div></div>' +
    '<nav class="nav" aria-label="Workspace views"><div class="nav-label">Workspace</div>' +
    '<button class="nav-button active" data-view="chat" aria-label="Conversation" aria-current="page">' + icons.chat + '<span>Conversation</span></button>' +
    '<button class="nav-button" data-view="changes" aria-label="Source Control">' + icons.changes + '<span>Source Control</span><span class="nav-count" id="change-count">0</span></button>' +
    '<button class="nav-button" data-view="terminal" aria-label="Terminal">' + icons.terminal + '<span>Terminal</span></button></nav>' +
    '<div class="workspace-meta"><div class="branch">' + icons.branch + '<span class="branch-name" id="branch-name">No repository</span></div><div class="sync" id="branch-sync"></div></div></aside>' +
    '<main class="main" id="workspace-main"><header class="topbar"><div class="view-heading"><h1 class="view-title" id="view-title">Conversation</h1><span class="view-subtitle" id="view-subtitle">Your local coding workspace</span></div><div class="topbar-actions"><span class="connection" id="connection" role="status" aria-live="polite">Connecting</span><button class="icon-button theme-button" id="theme-button" title="Use dark mode" aria-label="Use dark mode">' + icons.theme + '</button><button class="icon-button" id="refresh" title="Refresh source control" aria-label="Refresh source control">' + icons.refresh + '</button></div></header>' +
    '<div class="content"><aside class="context-rail" id="context-rail"><div class="context-resizer" id="context-resizer" role="separator" aria-orientation="vertical" aria-label="Resize context panel" tabindex="0"></div>' +
    '<section class="view changes-view" data-panel="changes"><aside class="changes-list"><div class="changes-heading"><span>CHANGES</span><button class="icon-button" id="changes-refresh" title="Refresh">' + icons.refresh + '</button></div><div id="changes-files"></div></aside><div class="diff-pane"><div class="diff-toolbar"><span class="diff-file-title" id="diff-file-title">Select a changed file</span><div class="diff-tabs"><button class="diff-tab active" data-diff="working">Working tree</button><button class="diff-tab" data-diff="staged">Staged</button></div></div><div class="diff" id="diff"></div></div></section>' +
    '<section class="view terminal-view" data-panel="terminal"><div class="terminal-toolbar"><div class="terminal-title"><span class="terminal-live"></span><span id="terminal-title">Local terminal</span></div><div class="terminal-actions"><button class="button" id="terminal-clear">Clear</button><button class="button" id="terminal-reset">Restart shell</button></div></div><div class="terminal-host" id="terminal-output" aria-label="Embedded terminal"></div></section></aside>' +
    '<section class="view chat-view active" data-panel="chat"><div class="conversation" id="conversation"><div class="conversation-inner" id="conversation-inner"><div class="welcome" id="welcome"><div class="eyebrow">DeepSeek Code · local workbench</div><h2>What are we building today?</h2><p>Start with the repository in front of you. DeepSeek can inspect the workspace, make the edits, and keep every decision visible.</p><div class="workspace-brief" aria-label="Repository context"><div class="brief-head"><span>WORKSPACE BRIEF</span><span class="brief-index">01 / 03</span></div><div class="brief-main"><div class="brief-orbit" aria-hidden="true"><span class="brief-orbit-ring"></span><span class="brief-orbit-ring brief-orbit-ring-small"></span><span class="brief-orbit-node brief-orbit-node-one"></span><span class="brief-orbit-node brief-orbit-node-two"></span><strong id="welcome-change-count">0</strong><small>pending files</small></div><div class="brief-copy"><span>Repository signal</span><strong id="welcome-project">Workspace</strong><p><span id="welcome-branch">Working tree</span> · the agent will show its path as it works.</p></div></div><div class="brief-footer"><span id="welcome-context-note">Waiting for workspace context</span><div class="suggestions"><button class="suggestion" id="suggest-review">Review the working tree</button><button class="suggestion">Trace the repository shape</button><button class="suggestion">Run a focused test pass</button></div></div></div></div></div></div><div class="composer-wrap"><form class="composer" id="composer"><div class="composer-caption"><span>Message DeepSeek Code</span><span>Enter to send</span></div><div class="command-menu" id="command-menu" role="listbox" aria-label="Command suggestions" hidden></div><textarea id="prompt" rows="2" aria-label="Message for DeepSeek Code" aria-autocomplete="list" aria-controls="command-menu" aria-expanded="false" placeholder="Describe the next change…"></textarea><div class="composer-foot"><button type="button" class="mode-button" id="mode-button"><span class="mode-dot"></span><span id="mode-label">Build</span></button><button class="send-button" id="send" title="Send (Enter)" aria-label="Send message">' + icons.send + '</button></div></form></div></section>' +
    '</div></main><aside class="rightbar"><section class="right-section session-panel"><div class="right-heading"><span>Session</span><span id="session-mode">BUILD</span></div><div class="session-state"><span class="session-state-dot"></span><span id="session-summary">Waiting for the local runtime.</span></div></section>' +
    '<section class="right-section telemetry-panel"><div class="right-heading"><span>Telemetry</span><span id="context-pct" title="Context window in use">—</span></div>' +
    '<div class="context-bar" role="progressbar" aria-label="Context usage" aria-valuemin="0" aria-valuemax="100"><div class="context-fill" id="context-fill"></div></div>' +
    '<div class="telemetry-grid">' +
    '<div class="telemetry-cell"><small>Tokens</small><strong id="stat-tokens">0</strong></div>' +
    '<div class="telemetry-cell"><small>Prompt</small><strong id="stat-prompt">0</strong></div>' +
    '<div class="telemetry-cell"><small>Cached</small><strong id="stat-cached">—</strong></div>' +
    '<div class="telemetry-cell"><small>Cost</small><strong id="stat-cost">$0.00</strong></div>' +
    '<div class="telemetry-cell"><small>Tool calls</small><strong id="stat-tools">0</strong></div>' +
    '<div class="telemetry-cell"><small>Files touched</small><strong id="stat-files">0</strong></div>' +
    '</div></section>' +
    '<section class="right-section todos-panel"><div class="right-heading"><span>Agent todos</span><span id="todo-count">0</span></div><ol class="todos-list" id="todos-list"></ol></section>' +
    '<section class="right-section fill"><div class="right-heading"><span>Live trace</span><button id="activity-clear">Clear</button></div><ol class="activity-list" id="activity" aria-live="polite"></ol></section><section class="right-section"><div class="right-heading"><span>Available tools</span><span id="tool-count">0</span></div><div class="tool-catalog" id="tool-catalog"></div></section></aside></div><div class="modal-layer" id="modal-layer"></div>';

  const el = { conversation: $('#conversation'), inner: $('#conversation-inner'), welcome: $('#welcome'), prompt: $('#prompt'), send: $('#send'), commandMenu: $('#command-menu'), themeButton: $('#theme-button'), connection: $('#connection'), modeLabel: $('#mode-label'), sessionMode: $('#session-mode'), sessionState: $('.session-state'), sessionSummary: $('#session-summary'), activity: $('#activity'), toolCatalog: $('#tool-catalog'), sourceFiles: $('#changes-files'), diff: $('#diff'), diffTitle: $('#diff-file-title'), output: $('#terminal-output'), modal: $('#modal-layer') };
  const token = new URLSearchParams(location.search).get('token') || '';
  const themeKey = 'deepseek-workshop-theme';
  const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
  const applyTheme = (theme, persist = true) => { document.documentElement.dataset.theme = theme; el.themeButton.innerHTML = theme === 'dark' ? icons.sun : icons.theme; el.themeButton.title = theme === 'dark' ? 'Use light mode' : 'Use dark mode'; el.themeButton.setAttribute('aria-label', el.themeButton.title); if (persist) { try { localStorage.setItem(themeKey, theme); } catch (_) {} } };
  let savedTheme = null; try { savedTheme = localStorage.getItem(themeKey); } catch (_) {}
  applyTheme(savedTheme === 'dark' || savedTheme === 'light' ? savedTheme : (systemTheme.matches ? 'dark' : 'light'), false);
  el.themeButton.addEventListener('click', () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
  systemTheme.addEventListener('change', (event) => { try { if (!localStorage.getItem(themeKey)) applyTheme(event.matches ? 'dark' : 'light', false); } catch (_) {} });
  document.querySelectorAll('[data-logo]').forEach((image) => { image.src = '/dsc-logo.png?token=' + encodeURIComponent(token); });
  const heartbeatLabel = make('div', 'session-heartbeat', 'Link telemetry · waiting'); $('.session-panel').append(heartbeatLabel);
  const toolFilter = document.createElement('input'); toolFilter.className = 'tool-filter'; toolFilter.type = 'search'; toolFilter.placeholder = 'Filter tools…'; toolFilter.setAttribute('aria-label', 'Filter available tools'); el.toolCatalog.parentElement.insertBefore(toolFilter, el.toolCatalog);
  const contextRail = $('#context-rail');
  const contextResizer = $('#context-resizer');
  const contextWidthKey = 'deepseek-workshop-context-width';
  const clampContextWidth = (width) => Math.min(720, Math.max(280, width));
  const setContextWidth = (width) => { const value = clampContextWidth(Number(width)); document.documentElement.style.setProperty('--context-width', value + 'px'); try { localStorage.setItem(contextWidthKey, String(value)); } catch (_) {} };
  try { const savedWidth = Number(localStorage.getItem(contextWidthKey)); if (Number.isFinite(savedWidth)) setContextWidth(savedWidth); } catch (_) {}
  const stageAll = make('button', 'button changes-action', 'Stage'); stageAll.type = 'button'; stageAll.title = 'Stage every changed file'; stageAll.setAttribute('aria-label', 'Stage all changed files');
  const unstageAll = make('button', 'button changes-action', 'Unstage'); unstageAll.type = 'button'; unstageAll.title = 'Unstage every staged file'; unstageAll.setAttribute('aria-label', 'Unstage all staged files');
  const commitButton = make('button', 'button changes-action primary-action', 'Commit'); commitButton.type = 'button'; commitButton.title = 'Commit staged changes'; commitButton.setAttribute('aria-label', 'Commit staged changes');
  const changesHeading = $('.changes-heading'); changesHeading.insertBefore(stageAll, $('#changes-refresh')); changesHeading.insertBefore(unstageAll, $('#changes-refresh')); changesHeading.insertBefore(commitButton, $('#changes-refresh'));
  const send = (payload) => { if (!state.connected || !state.ws || state.ws.readyState !== WebSocket.OPEN) return false; state.ws.send(JSON.stringify(payload)); return true; };
  const setConnection = (connected, label, className = connected ? 'connection online' : 'connection error') => { state.connected = connected; el.connection.textContent = label; el.connection.className = className; document.body.dataset.connection = connected ? 'online' : 'offline'; el.send.disabled = !connected; };
  const updateWelcomeContext = (source) => { const count = source?.files?.length || 0; const branch = source?.repository ? (source.branch || 'Detached HEAD') : 'No repository'; $('#welcome-change-count')?.replaceChildren(document.createTextNode(String(count))); $('#welcome-branch')?.replaceChildren(document.createTextNode(branch)); $('#welcome-context-note')?.replaceChildren(document.createTextNode(source?.repository ? (count ? count + ' files are waiting for your attention' : 'Working tree is clean') : 'This workspace is not a Git repository')); const review = $('#suggest-review'); if (review) review.textContent = count ? 'Review ' + count + ' pending changes' : 'Review the working tree'; };
  let commandMatches = [];
  let commandSelectedIndex = 0;
  const getCommandMatches = (value) => {
    if (!value.startsWith('/') || /\s/.test(value)) return [];
    if (value === '/') return COMMAND_SUGGESTIONS;
    if (value.length < 2) return [];
    const prefixMatches = COMMAND_SUGGESTIONS.filter((command) => command.startsWith(value));
    if (prefixMatches.length) return prefixMatches;
    const query = value.slice(1).toLowerCase();
    return COMMAND_SUGGESTIONS.filter((command) => command.slice(1).toLowerCase().includes(query)).slice(0, 8);
  };
  const closeCommandMenu = () => { commandMatches = []; commandSelectedIndex = 0; el.commandMenu.hidden = true; el.prompt.setAttribute('aria-expanded', 'false'); };
  const acceptCommand = (command) => { el.prompt.value = command + ' '; el.prompt.focus(); el.prompt.setSelectionRange(el.prompt.value.length, el.prompt.value.length); closeCommandMenu(); };
  const renderCommandMenu = () => {
    commandMatches = getCommandMatches(el.prompt.value);
    commandSelectedIndex = Math.min(commandSelectedIndex, Math.max(0, commandMatches.length - 1));
    el.commandMenu.replaceChildren(...commandMatches.map((command, index) => {
      const option = make('button', 'command-option' + (index === commandSelectedIndex ? ' selected' : ''));
      option.type = 'button'; option.role = 'option'; option.dataset.command = command; option.setAttribute('aria-selected', String(index === commandSelectedIndex));
      option.append(make('strong', 'command-name', command), make('span', 'command-description', COMMAND_DESCRIPTIONS[command] || 'Run command'));
      option.addEventListener('mousedown', (event) => event.preventDefault()); option.addEventListener('click', () => acceptCommand(command));
      return option;
    }));
    const open = commandMatches.length > 0;
    el.commandMenu.hidden = !open; el.prompt.setAttribute('aria-expanded', String(open));
    if (open) el.commandMenu.querySelector('.command-option.selected')?.scrollIntoView({ block: 'nearest' });
  };
  const safe = (value) => typeof value === 'string' ? value : JSON.stringify(value || {});
  // Stick to the bottom only while the reader is already there; never yank the
  // scroll position away from someone reading earlier messages.
  const nearBottom = () => { const node = el.conversation; return node.scrollHeight - node.scrollTop - node.clientHeight < 90; };
  const scrollConversation = (force = false) => { if (force || nearBottom()) el.conversation.scrollTop = el.conversation.scrollHeight; };
  const clearWelcome = () => { if (el.welcome) { el.welcome.remove(); el.welcome = null; } };
  const addInline = (node, value) => { const marker = String.fromCharCode(96); value.split(new RegExp('(' + marker + '[^' + marker + '\\n]+' + marker + ')', 'g')).forEach((part) => { if (part.startsWith(marker) && part.endsWith(marker)) node.append(make('code', 'message-inline-code', part.slice(1, -1))); else node.append(document.createTextNode(part)); }); };
  const renderAssistant = (content) => { const value = content.dataset.raw || ''; const fence = String.fromCharCode(96).repeat(3); let codeLines = null; content.replaceChildren(); const flushCode = () => { if (!codeLines) return; const pre = make('pre', 'message-code'); pre.append(make('code', '', codeLines.join('\n'))); content.append(pre); codeLines = null; }; value.split('\n').forEach((line) => { if (line.startsWith(fence)) { if (codeLines) flushCode(); else codeLines = []; return; } if (codeLines) { codeLines.push(line); return; } const heading = /^(#{1,3})\s+(.+)$/.exec(line); const list = /^[-*]\s+(.+)$/.exec(line); const block = make('div', heading ? 'message-heading' : list ? 'message-list-item' : 'message-line'); addInline(block, heading ? heading[2] : list ? list[1] : line || ' '); content.append(block); }); flushCode(); };
  const addMessage = (role, text) => { clearWelcome(); const message = make('article', 'message ' + role); const mark = make('div', 'message-mark'); mark.innerHTML = role === 'assistant' ? deepseekLogo : role === 'user' ? 'M' : '·'; const logo = mark.querySelector('[data-logo]'); if (logo) logo.src = '/dsc-logo.png?token=' + encodeURIComponent(token); const body = make('div', 'message-body'); body.append(make('div', 'message-label', role === 'user' ? 'You' : role === 'thinking' ? 'Thinking' : 'DeepSeek Code')); const content = make('div', 'message-content', text || ''); if (role === 'assistant') content.dataset.raw = text || ''; body.append(content); message.append(mark, body); el.inner.append(message); scrollConversation(); persistState(); return content; };
  let assistantRenderFrame = 0;
  const pendingAssistantRenders = new Set();
  const flushAssistantRenders = () => { assistantRenderFrame = 0; pendingAssistantRenders.forEach((content) => renderAssistant(content)); pendingAssistantRenders.clear(); };
  const scheduleAssistantRender = (content) => { pendingAssistantRenders.add(content); if (!assistantRenderFrame) assistantRenderFrame = requestAnimationFrame(flushAssistantRenders); };
  const appendAssistant = (content, text) => { content.dataset.raw = (content.dataset.raw || '') + text; scheduleAssistantRender(content); persistState(); };
  const addTool = (name, args, running = true, previewText) => {
    clearWelcome();
    const meta = toolMeta(name);
    const row = make('article', 'tool-card' + (running ? ' running' : ''));
    row.dataset.tool = name;
    row.dataset.preview = previewText ?? summarizeArgs(name, args);
    row.dataset.result = '';
    const header = make('button', 'tool-card-head');
    header.type = 'button';
    header.setAttribute('aria-expanded', 'false');
    const status = make('span', 'tool-status');
    const glyph = make('span', 'tool-card-icon');
    glyph.innerHTML = meta.icon;
    const label = make('span', 'tool-card-name', meta.display);
    const preview = make('span', 'tool-card-preview', row.dataset.preview);
    header.append(status, glyph, label, preview);
    header.addEventListener('click', () => {
      const open = row.classList.toggle('open');
      header.setAttribute('aria-expanded', String(open));
    });
    const body = make('div', 'tool-card-body');
    if (args && typeof args === 'object' && Object.keys(args).length) body.append(make('pre', 'tool-card-args', JSON.stringify(args, null, 2)));
    if (name === 'write_file' && typeof args?.content === 'string') renderInlineDiff(body, 'write', '', String(args.content).split('\n').slice(0, 400).join('\n'));
    if (name === 'edit_file') renderInlineDiff(body, 'edit', typeof args?.old_string === 'string' ? args.old_string : '', typeof args?.new_string === 'string' ? args.new_string : '');
    if (name === 'patch_file' && typeof args?.patch === 'string') renderPatchDiff(body, String(args.patch).split('\n').slice(0, 400).join('\n'));
    const resultHost = make('div', 'tool-card-result');
    body.append(resultHost);
    row.append(header, body);
    el.inner.append(row);
    scrollConversation();
    persistState();
    return row;
  };
  const setToolResult = (row, name, result) => {
    row.classList.remove('running');
    row.dataset.result = summarizeResult(name, result);
    const host = row.querySelector('.tool-card-result');
    if (!host) return;
    host.replaceChildren();
    const text = String(result ?? '');
    if (name === 'todo' && (text.trim().startsWith('[') || text.trim().startsWith('{'))) {
      try {
        const parsed = JSON.parse(text);
        const items = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.todos) ? parsed.todos : null;
        if (items && items.length) { renderTodoList(host, items); return; }
      } catch (_) {}
    }
    if (text.trim()) {
      const pre = make('pre', 'tool-card-output' + (text.length > 1200 ? ' long' : ''), text);
      if (text.length > 1200) {
        const more = make('button', 'tool-card-more', 'Show full output');
        more.type = 'button';
        more.addEventListener('click', () => { pre.classList.toggle('expanded'); more.textContent = pre.classList.contains('expanded') ? 'Collapse output' : 'Show full output'; });
        host.append(pre, more);
        return;
      }
      host.append(pre);
    }
    const summary = make('div', 'tool-card-summary', row.dataset.result);
    host.append(summary);
  };
  const addActivity = (name, args, active = true, result = '', taskId = '', pending = false) => { const item = { id: Date.now() + Math.random(), taskId, name, args, active, result, progress: '', pending }; state.activity.unshift(item); state.activity = state.activity.slice(0, 80); renderActivity(); persistState(); return item; };
  const activityKind = (item) => item.taskId ? 'subagent' : item.name.startsWith('subagent reply') ? 'reply' : 'tool';
  const renderActivity = () => { el.activity.replaceChildren(); if (!state.activity.length) { const empty = make('li', 'empty', 'The agent trace will appear here.'); el.activity.append(empty); return; } state.activity.forEach((item) => { const kind = activityKind(item); const row = make('li', 'activity-item' + (item.active ? ' active' : '') + (item.pending ? ' pending' : '')); row.dataset.kind = kind; row.setAttribute('aria-label', item.name + ' · ' + (item.pending ? 'queued' : item.active ? 'running' : 'done')); const marker = make('span', 'activity-marker', kind === 'subagent' ? '↗' : kind === 'reply' ? '↳' : '·'); const body = make('div', 'activity-body'); const top = make('div', 'activity-top'); top.append(make('span', 'activity-tool', item.name), make('span', 'activity-state', item.pending ? 'QUEUED' : item.active ? 'RUNNING' : 'DONE')); body.append(top, make('div', 'activity-detail', item.active ? (item.progress ? item.args + ' · ' + item.progress : item.args) : item.result || item.args)); if (item.active) body.append(make('div', 'activity-pulse', item.progress || 'processing')); row.append(marker, body); el.activity.append(row); }); };
  const sessionStorageKey = 'deepseek-workshop-session:' + token;
  // Streaming can fire hundreds of persistState calls per turn; serialize to
  // sessionStorage at most every 400ms so the UI thread never blocks on it.
  let persistTimer = null;
  const persistState = () => { if (persistTimer !== null) return; persistTimer = setTimeout(() => { persistTimer = null; persistSnapshot(); }, 400); };
  const persistSnapshot = () => { try { const messages = Array.from(el.inner.querySelectorAll('.message')).slice(-100).map((node) => { const role = Array.from(node.classList).find((name) => ['user', 'assistant', 'thinking'].includes(name)) || 'assistant'; const content = $('.message-content', node); return { role, text: (content?.dataset.raw || content?.textContent || '').slice(-20_000) }; }); const tools = Array.from(el.inner.querySelectorAll('.tool-card')).slice(-100).map((node) => ({ name: node.dataset.tool || '', preview: node.dataset.preview || '', result: node.dataset.result || '', running: node.classList.contains('running') })); const snapshot = JSON.stringify({ messages, tools, activity: state.activity.slice(0, 80), mode: state.mode, view: state.view }); if (snapshot.length <= 256_000) sessionStorage.setItem(sessionStorageKey, snapshot); } catch (_) {} };
  const restoreState = () => { try { const raw = sessionStorage.getItem(sessionStorageKey); if (!raw) return; const saved = JSON.parse(raw); if (Array.isArray(saved.messages)) saved.messages.forEach((message) => { if (!message || !['user', 'assistant', 'thinking'].includes(message.role) || typeof message.text !== 'string') return; const content = addMessage(message.role, message.text); if (message.role === 'assistant') renderAssistant(content); }); if (Array.isArray(saved.tools)) saved.tools.forEach((tool) => { if (tool && typeof tool.name === 'string') { const row = addTool(tool.name, null, Boolean(tool.running), typeof tool.preview === 'string' ? tool.preview : undefined); if (tool.result) setToolResult(row, tool.name, tool.result); } }); if (Array.isArray(saved.activity)) state.activity = saved.activity.filter((item) => item && typeof item.name === 'string').slice(0, 80); if (modes.includes(saved.mode)) setMode(saved.mode); if (['chat', 'changes', 'terminal'].includes(saved.view)) setView(saved.view); renderActivity(); } catch (_) { sessionStorage.removeItem(sessionStorageKey); } };
  const renderTools = () => { const query = toolFilter.value.trim().toLowerCase(); const tools = state.tools.filter((tool) => !query || (tool.name + ' ' + tool.description).toLowerCase().includes(query)); $('#tool-count').textContent = query ? tools.length + '/' + state.tools.length : String(state.tools.length); el.toolCatalog.replaceChildren(...(tools.length ? tools.map((tool) => { const pill = make('button', 'tool-pill', tool.name); pill.type = 'button'; pill.title = tool.description; pill.setAttribute('aria-label', tool.name + ': ' + tool.description); pill.addEventListener('click', () => showToolDetails(tool)); return pill; }) : [make('div', 'empty tool-empty', 'No matching tools.') ])); };
  const statusKind = (file) => file.indexStatus !== ' ' ? file.indexStatus : file.worktreeStatus;
  const statusClass = (status) => /A|\?/.test(status) ? 'add' : /D/.test(status) ? 'remove' : 'modify';
  const statusText = (status) => status === '?' ? 'U' : status || 'M';
  const renderSource = () => { const source = state.source; const count = source ? source.files.length : 0; $('#change-count').textContent = String(count); $('#branch-name').textContent = source && source.repository ? (source.branch || 'Detached HEAD') : 'No repository'; $('#branch-sync').textContent = source && source.repository && (source.ahead || source.behind) ? ('↑ ' + source.ahead + '  ↓ ' + source.behind) : ''; const files = source?.files || []; const stagedFiles = files.filter((file) => file.indexStatus !== ' ' && file.indexStatus !== '?'); stageAll.textContent = 'Stage ' + files.length; unstageAll.textContent = 'Unstage ' + stagedFiles.length; commitButton.textContent = 'Commit ' + stagedFiles.length; stageAll.disabled = !source?.repository || files.length === 0; unstageAll.disabled = stagedFiles.length === 0; commitButton.disabled = stagedFiles.length === 0; el.sourceFiles.replaceChildren(); if (!source || !source.repository) { el.sourceFiles.append(make('div', 'empty', 'This workspace is not a Git repository.')); renderDiff(''); return; } if (!source.files.length) { el.sourceFiles.append(make('div', 'empty', 'Working tree clean.')); renderDiff(''); return; } const staged = source.files.filter((f) => f.indexStatus !== ' ' && f.indexStatus !== '?'); const unstaged = source.files.filter((f) => f.worktreeStatus !== ' ' || f.indexStatus === '?'); const group = (title, files, isStaged) => { if (!files.length) return; const block = make('div', 'changes-group'); const heading = make('div', 'changes-group-title'); heading.append(make('span', title), make('span', String(files.length))); block.append(heading); files.forEach((file) => { const item = make('div', 'change-file' + (file.path === source.selectedPath ? ' selected' : '')); item.tabIndex = 0; const status = statusKind(file); item.append(make('span', 'change-status ' + statusClass(status), statusText(status)), make('span', 'change-path', file.path)); const select = () => send({ type: 'refresh_source_control', path: file.path }); item.addEventListener('click', select); item.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(); } }); const toggle = make('button', 'stage-toggle' + (isStaged ? ' staged' : ''), isStaged ? '−' : '+'); toggle.title = isStaged ? 'Unstage file' : 'Stage file'; toggle.addEventListener('click', (event) => { event.stopPropagation(); send({ type: isStaged ? 'unstage_files' : 'stage_files', paths: [file.path] }); }); item.append(toggle); block.append(item); }); el.sourceFiles.append(block); }; group('Staged', staged, true); group('Changes', unstaged, false); renderDiff(state.diffTab === 'staged' ? source.stagedDiff : source.diff); };
  const renderDiff = (text) => { el.diff.replaceChildren(); const source = state.source; el.diffTitle.textContent = source && source.selectedPath ? source.selectedPath : 'Select a changed file'; if (!text) { el.diff.append(make('div', 'diff-empty', source && source.selectedPath ? 'No ' + (state.diffTab === 'staged' ? 'staged' : 'working tree') + 'diff for this file.' : 'Select a changed file to inspect its diff.')); return; } let before = 0, after = 0; text.split('\n').forEach((line) => { let cls = 'meta', left = '', right = ''; const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(line); if (hunk) { before = Number(hunk[1]); after = Number(hunk[2]); cls = 'hunk'; } else if (line.startsWith('+') && !line.startsWith('+++')) { cls = 'add'; right = String(after++); } else if (line.startsWith('-') && !line.startsWith('---')) { cls = 'remove'; left = String(before++); } else if (!line.startsWith('diff ') && !line.startsWith('index ') && !line.startsWith('---') && !line.startsWith('+++') && before) { left = String(before++); right = String(after++); cls = ''; } const row = make('div', 'diff-line' + (cls ? ' ' + cls : '')); row.append(make('span', 'diff-num', left), make('span', 'diff-num', right), make('span', 'diff-code', line)); el.diff.append(row); }); };
  const setMode = (mode) => { state.mode = mode; el.modeLabel.textContent = mode[0].toUpperCase() + mode.slice(1); el.sessionMode.textContent = mode.toUpperCase(); };
  const formatTokens = (value) => value >= 1_000_000 ? (value / 1_000_000).toFixed(1) + 'M' : value >= 1_000 ? (value / 1_000).toFixed(1) + 'k' : String(value);
  const renderStats = (stats) => {
    if (!stats || typeof stats !== 'object') return;
    state.stats = stats;
    const pct = stats.contextLimit > 0 ? Math.min(100, Math.round((stats.contextUsage / stats.contextLimit) * 100)) : 0;
    const pctLabel = $('#context-pct'); const fill = $('#context-fill');
    if (pctLabel) pctLabel.textContent = stats.contextLimit > 0 ? pct + '%' : '—';
    if (fill) { fill.style.width = pct + '%'; fill.classList.toggle('warn', pct >= 70); fill.classList.toggle('crit', pct >= 90); }
    const set = (id, value) => { const node = $(id); if (node) node.textContent = value; };
    set('#stat-tokens', formatTokens(stats.tokenCount || 0));
    set('#stat-prompt', formatTokens(stats.promptTokens || 0));
    set('#stat-cached', stats.promptTokens > 0 ? Math.round(((stats.cachedTokens || 0) / stats.promptTokens) * 100) + '%' : '—');
    set('#stat-cost', '$' + (stats.costUsd || 0).toFixed(stats.costUsd >= 1 ? 2 : 4));
    set('#stat-tools', String(stats.toolCalls || 0));
    set('#stat-files', String(stats.filesModified || 0));
  };
  const todoMark = (status) => status === 'done' ? '✓' : status === 'in_progress' ? '◐' : '○';
  const renderTodos = (items) => {
    const list = $('#todos-list'); const count = $('#todo-count');
    if (!list || !Array.isArray(items)) return;
    state.todos = items;
    if (count) count.textContent = String(items.length);
    list.replaceChildren(...(items.length ? items.map((item) => {
      const row = make('li', 'todos-item ' + (item.status === 'in_progress' ? 'current' : item.status === 'done' ? 'done' : ''));
      row.append(make('span', 'todos-mark', todoMark(item.status)), make('span', 'todos-title', item.title || ''));
      return row;
    }) : [make('li', 'empty', 'No active todos. The agent will list its plan here.')]));
  };
  const setSessionState = (text, busy = false) => { el.sessionSummary.textContent = text; el.sessionState.classList.toggle('busy', busy); };
  const updateHeartbeat = () => { if (!state.lastHeartbeat) return; const age = Math.max(0, Date.now() - state.lastHeartbeat); const stale = age > 15_000; heartbeatLabel.classList.toggle('stale', stale); heartbeatLabel.textContent = stale ? 'Link telemetry · stale' : 'Last signal · ' + Math.round(age / 1000) + 's ago'; };
  const setView = (view) => { state.view = view; const contextOpen = view !== 'chat'; const main = document.querySelector('.main'); main.classList.toggle('context-open', contextOpen); main.dataset.context = contextOpen ? view : ''; contextRail.classList.toggle('open', contextOpen); contextRail.setAttribute('aria-hidden', String(!contextOpen)); document.querySelectorAll('[data-panel]').forEach((panel) => panel.classList.toggle('active', panel.dataset.panel === view || (contextOpen && panel.dataset.panel === 'chat'))); document.querySelectorAll('[data-view]').forEach((button) => { const active = button.dataset.view === view; button.classList.toggle('active', active); button.toggleAttribute('aria-current', active); }); const labels = { chat: ['Conversation', 'Your local coding workspace'], changes: ['Source Control', 'Review and stage changes'], terminal: ['Local terminal', 'Run commands in this workspace'] }; $('#view-title').textContent = labels[view][0]; $('#view-subtitle').textContent = labels[view][1]; if (view === 'terminal') openTerminal(); };
  const terminalSize = () => ({ cols: Math.max(40, Math.floor(el.output.clientWidth / 7.9)), rows: Math.max(12, Math.floor(el.output.clientHeight / 17.2)) });
  const syncTerminalSize = () => { if (!state.terminal) return; const size = terminalSize(); if (state.terminal.cols === size.cols && state.terminal.rows === size.rows) return; state.terminal.resize(size.cols, size.rows); };
  const createTerminal = () => {
    if (state.terminal) return state.terminal;
    if (!globalThis.Terminal) { addMessage('assistant', 'Terminal renderer failed to load. Refresh the page and try again.'); return null; }
    const terminal = new globalThis.Terminal({ cursorBlink: true, cursorStyle: 'bar', scrollback: 10_000, fontSize: 13, lineHeight: 1.25, fontFamily: '"JetBrains Mono", "Cascadia Code", ui-monospace, monospace', theme: { background: '#151b29', foreground: '#f2f5fb', cursor: '#7c9cff', cursorAccent: '#151b29', selectionBackground: 'rgba(124, 156, 255, .28)', black: '#151b29', brightBlack: '#66718a', red: '#f07d72', brightRed: '#ffaaa1', green: '#64c68a', brightGreen: '#9be5b6', yellow: '#e6b65d', brightYellow: '#f5d98e', blue: '#7c9cff', brightBlue: '#a7bbff', magenta: '#b38cff', brightMagenta: '#d2bfff', cyan: '#60c9d9', brightCyan: '#9de8f1', white: '#d8dfed', brightWhite: '#ffffff' } });
    terminal.open(el.output);
    terminal.onData((data) => send({ type: 'terminal_input', data }));
    terminal.onResize(({ cols, rows }) => { if (state.terminalOpened) send({ type: 'terminal_resize', cols, rows }); });
    state.terminal = terminal;
    state.terminalResizeObserver = new ResizeObserver(() => requestAnimationFrame(syncTerminalSize));
    state.terminalResizeObserver.observe(el.output);
    return terminal;
  };
  const appendTerminal = (data) => state.terminal?.write(data);
  const openTerminal = () => { const terminal = createTerminal(); if (!terminal) return; const size = terminalSize(); if (terminal.cols !== size.cols || terminal.rows !== size.rows) terminal.resize(size.cols, size.rows); if (!state.terminalOpened) { if (state.sawTerminalExit) { terminal.reset(); state.sawTerminalExit = false; } state.terminalOpened = true; send({ type: 'terminal_open', cols: size.cols, rows: size.rows }); } setTimeout(() => terminal.focus(), 0); };
  const closeModal = () => { state.modal = null; el.modal.classList.remove('open'); el.modal.replaceChildren(); state.modalOrigin?.focus(); state.modalOrigin = null; };
  const modal = (title, subtitle, body, actions) => { state.modalOrigin = document.activeElement; el.modal.replaceChildren(); const dialog = make('section', 'modal'); const titleId = 'modal-title-' + Date.now(); dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-labelledby', titleId); const header = make('div', 'modal-header'); const heading = make('h2', 'modal-title', title); heading.id = titleId; header.append(heading, make('div', 'modal-subtitle', subtitle)); const content = make('div', 'modal-body'); if (body) content.append(body); const footer = make('div', 'modal-actions'); actions.forEach((action) => { const button = make('button', 'action ' + (action.className || ''), action.label); button.addEventListener('click', action.onClick); footer.append(button); }); dialog.addEventListener('keydown', (event) => { if (event.key === 'Escape') { event.preventDefault(); dialog.querySelector('.danger')?.click(); return; } if (event.key !== 'Tab') return; const focusable = Array.from(dialog.querySelectorAll('button, input')).filter((item) => !item.disabled); if (!focusable.length) return; const first = focusable[0]; const last = focusable[focusable.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } }); dialog.append(header, content, footer); el.modal.append(dialog); el.modal.classList.add('open'); state.modal = dialog; requestAnimationFrame(() => dialog.querySelector('input, button')?.focus()); };
  const showConfirm = (event, label = 'Confirm') => { const body = make('pre', '', event.message || event.summary || ''); modal(label, 'The agent is waiting for your decision.', body, [{ label: 'Cancel', className: 'danger', onClick: () => { send({ type: event.response, requestId: event.requestId, approved: false }); closeModal(); } }, { label: 'Approve', className: 'primary', onClick: () => { send({ type: event.response, requestId: event.requestId, approved: true }); closeModal(); } }]); };
  const showCommit = () => { const input = make('input', 'question-text'); input.placeholder = 'Commit message'; input.maxLength = 500; input.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); input.closest('.modal')?.querySelector('.primary')?.click(); } }); modal('Commit staged changes', 'Only files already staged will be committed.', input, [{ label: 'Cancel', className: 'danger', onClick: closeModal }, { label: 'Commit', className: 'primary', onClick: () => { const message = input.value.trim(); if (!message) { input.focus(); return; } if (send({ type: 'commit', message })) { closeModal(); setSessionState('Creating commit…', true); } } }]); };
  const showToolDetails = (tool) => { const body = make('div', 'tool-details'); body.append(make('div', 'tool-details-name', tool.name), make('p', 'tool-details-description', tool.description || 'No description provided.')); modal('Tool inspector', 'Available in this DeepSeek Code session.', body, [{ label: 'Close', className: 'primary', onClick: closeModal }]); };
  const showPermission = (event) => { const body = document.createDocumentFragment(); const message = make('div', 'message-content', event.riskDescription || ('Allow ' + event.toolName + ' to run?')); const details = make('pre', '', safe(event.args)); body.append(message, details); const decisions = [['deny', 'Deny'], ['once', 'Allow once'], ['session', 'Allow this session'], ['directory', 'Allow directory'], ['always', 'Always allow']]; modal('Tool permission', event.reason.replace('_', ' ') + ' · ' + event.toolName, body, decisions.map(([decision, label]) => ({ label, className: decision === 'once' ? 'primary' : decision === 'deny' ? 'danger' : '', onClick: () => { send({ type: 'permission_response', requestId: event.requestId, decision }); closeModal(); } }))); };
  const showQuestions = (event) => { const body = make('div'); event.questions.forEach((question, index) => { const block = make('section', 'question'); block.dataset.index = String(index); block.dataset.type = question.type || 'choice'; block.dataset.multi = question.multiSelect ? 'true' : 'false'; block.append(make('div', 'question-header', question.header || 'Question'), make('div', 'question-title', question.question)); if (question.type === 'text') { const input = make('input', 'question-text'); input.placeholder = question.placeholder || 'Type your answer'; block.append(input); } else { const options = question.type === 'yesno' ? [{ label: 'Yes', description: 'Proceed.' }, { label: 'No', description: 'Do not proceed.' }] : question.options || []; const choices = make('div', 'question-options'); options.forEach((option, optionIndex) => { const label = make('label', 'choice'); const input = document.createElement('input'); input.type = question.multiSelect ? 'checkbox' : 'radio'; input.name = 'q' + index; input.value = option.label; if (!question.multiSelect && optionIndex === 0) input.checked = true; label.append(input, make('span', '', option.label), make('small', '', option.description)); choices.append(label); }); block.append(choices); } body.append(block); }); modal('Questions from the agent', 'Your answers are passed straight back to the running tool.', body, [{ label: 'Cancel', className: 'danger', onClick: () => { send({ type: 'questions_response', requestId: event.requestId, answers: null }); closeModal(); } }, { label: 'Submit answers', className: 'primary', onClick: () => { const answers = {}; body.querySelectorAll('.question').forEach((block) => { const index = block.dataset.index; if (block.dataset.type === 'text') { answers[index] = $('.question-text', block).value.trim(); } else { const values = Array.from(block.querySelectorAll('input:checked')).map((input) => input.value); answers[index] = block.dataset.multi === 'true' ? JSON.stringify(values) : (values[0] || ''); } }); send({ type: 'questions_response', requestId: event.requestId, answers }); closeModal(); } }]); };
  const showPlan = (event) => { const body = make('div'); if (event.summary) body.append(make('div', 'modal-subtitle', event.summary)); body.append(make('pre', '', event.content)); const feedback = make('input', 'question-text'); feedback.placeholder = 'Feedback if you want the plan revised'; body.append(feedback); modal('Plan review', 'Approve to change the agent into Build mode.', body, [{ label: 'Abort', className: 'danger', onClick: () => { send({ type: 'plan_review_response', requestId: event.requestId, approved: false, aborted: true }); closeModal(); } }, { label: 'Request revision', onClick: () => { send({ type: 'plan_review_response', requestId: event.requestId, approved: false, feedback: feedback.value }); closeModal(); } }, { label: 'Approve plan', className: 'primary', onClick: () => { send({ type: 'plan_review_response', requestId: event.requestId, approved: true }); closeModal(); } }]); };
  const setRunning = (running) => { state.running = running; el.send.innerHTML = running ? icons.stop : icons.send; el.send.title = running ? 'Stop agent (Escape)' : 'Send (Enter)'; el.send.setAttribute('aria-label', running ? 'Stop agent' : 'Send message'); el.send.classList.toggle('stop-button', running); el.send.disabled = !state.connected; };
  const stopAgent = () => { if (!state.running || !state.connected) return; if (send({ type: 'abort' })) { setSessionState('Stopping the agent…', true); el.send.disabled = true; } };
  const runPrompt = () => { if (state.running) { stopAgent(); return; } const prompt = el.prompt.value.trim(); if (!prompt) return; if (!state.connected) { setSessionState('Waiting for the connection to return.'); el.prompt.focus(); return; } addMessage('user', prompt); state.activeAssistant = null; state.activeThinking = null; if (!send({ type: 'run', prompt })) return; el.prompt.value = ''; el.prompt.style.height = ''; scrollConversation(true); setRunning(true); setSessionState('The agent is working in the local workspace.', true); };
  const onEvent = (event) => { switch (event.type) {
    case 'hello': { state.tools = event.tools || []; state.source = event.sourceControl; setMode(event.mode); renderStats(event.stats); renderTodos(event.todos || []); $('#project-path').textContent = event.cwd; $('#project-name').textContent = event.cwd.split('/').filter(Boolean).pop() || 'Workspace'; $('#view-subtitle').textContent = event.model + ' · ' + event.cwd; renderTools(); renderSource(); break; }
    case 'token': if (!state.activeAssistant) state.activeAssistant = addMessage('assistant', ''); appendAssistant(state.activeAssistant, event.text); scrollConversation(); break;
    case 'thinking': if (!state.activeThinking) state.activeThinking = addMessage('thinking', ''); state.activeThinking.append(document.createTextNode(event.text)); scrollConversation(); break;
    case 'tool_pending': { setSessionState('Preparing ' + event.name + '…', true); addActivity(event.name, event.argsText, true, '', '', true); break; }
    case 'tool_call': { state.activeAssistant = null; state.activeThinking = null; setSessionState('Running ' + toolMeta(event.name).display + '.', true); addTool(event.name, event.args && typeof event.args === 'object' ? event.args : null); const pending = state.activity.find((item) => item.pending && item.active && item.name === event.name); if (pending) { pending.pending = false; pending.args = summarizeArgs(event.name, event.args) || safe(event.args); renderActivity(); } else addActivity(event.name, summarizeArgs(event.name, event.args) || safe(event.args), true); break; }
    case 'tool_result': { const active = state.activity.find((item) => item.active && !item.pending && item.name === event.name) || state.activity.find((item) => item.active && item.name === event.name); if (active) { active.active = false; active.pending = false; active.result = summarizeResult(event.name, event.result); renderActivity(); } const row = Array.from(el.inner.querySelectorAll('.tool-card.running')).reverse().find((item) => item.dataset.tool === event.name); if (row) setToolResult(row, event.name, event.result); break; }
    case 'phase': setSessionState(event.phase === 'refining' ? 'Refining the prompt…' : 'Agent is executing tools.', true); break;
    case 'source_control': state.source = event.snapshot; renderSource(); break;
    case 'stats': renderStats(event.stats); break;
    case 'todos': renderTodos(event.items); break;
    case 'mode': setMode(event.mode); break;
    case 'command_result': { setRunning(false); if (event.clear) { el.inner.replaceChildren(); el.welcome = null; state.activity = []; renderActivity(); } const content = addMessage('assistant', event.content); renderAssistant(content); break; }
    case 'terminal_data': appendTerminal(event.data); break;
    case 'terminal_exit': appendTerminal('\r\n\r\n\x1b[38;5;180m[terminal exited: ' + event.code + ']\x1b[0m\r\n'); state.terminalOpened = false; state.sawTerminalExit = true; break;
    case 'subagent_start': setSessionState('Subagent ' + (event.agentName || 'worker') + ' is working.', true); addActivity(event.agentName || 'subagent', event.task, true, '', event.id); break;
    case 'subagent_tool': addActivity('subagent · ' + event.tool, event.info || event.id, true, '', event.id); break;
    case 'subagent_tokens': { const item = state.activity.find((entry) => entry.taskId === event.id && entry.active); if (item) { item.progress = event.tokens.toLocaleString() + ' tokens'; renderActivity(); } break; }
    case 'subagent_message': if (event.role === 'assistant') addActivity('subagent reply', event.content, false, event.content); break;
    case 'subagent_done': { state.activity.filter((item) => item.taskId === event.id && item.active).forEach((item) => { item.active = false; item.result = event.result; }); renderActivity(); break; }
    case 'subagent_error': { state.activity.filter((item) => item.taskId === event.id && item.active).forEach((item) => { item.active = false; item.result = event.error; }); renderActivity(); addMessage('assistant', 'Subagent error: ' + event.error); break; }
    case 'permission_request': showPermission(event); break;
    case 'confirm_request': showConfirm({ ...event, response: 'confirm_response' }, 'Confirmation'); break;
    case 'questions_request': showQuestions(event); break;
    case 'diff_review_request': showConfirm({ ...event, message: event.summary, response: 'diff_review_response' }, 'Review changes'); break;
    case 'plan_review_request': showPlan(event); break;
    case 'verification_request': showConfirm({ ...event, message: 'Files changed:\n' + event.files.join('\n') + '\n\nRun ' + event.command + '?', response: 'verification_response' }, 'Run verification'); break;
    case 'verification_result': addMessage('assistant', (event.ok ? 'Verification passed: ' : 'Verification failed: ') + event.command + '\n\n' + event.output); break;
    case 'commit_result': addMessage('assistant', 'Committed: ' + event.message + (event.output ? '\n\n' + event.output : '')); setSessionState('Commit created.'); break;
    case 'micro_compact': addMessage('assistant', 'Context compacted · freed approximately ' + event.freedTokensEstimate + ' tokens.'); break;
    case 'auto_compact': addMessage('assistant', 'Context compacted automatically.\n\n' + event.summary); break;
    case 'deny_abort': addMessage('assistant', 'The requested operation was cancelled.'); break;
    case 'done': setRunning(false); el.inner.querySelectorAll('.message.assistant .message-content').forEach(renderAssistant); state.activeAssistant = null; state.activeThinking = null; setSessionState('Ready for the next task.'); send({ type: 'refresh_source_control' }); break;
    case 'error': setRunning(false); addMessage('assistant', 'Error: ' + event.message); setSessionState('The runtime reported an error.'); break;
    case 'session_gap': addMessage('assistant', 'Some activity happened while the browser was offline and fell outside the replay window.'); setSessionState('Session partially restored.'); break;
    case 'heartbeat': state.lastHeartbeat = event.at; updateHeartbeat(); break;
  } persistState(); };
  const acceptEvent = (event) => { if (typeof event.seq === 'number') { if (event.seq <= state.lastEventSeq) return; state.lastEventSeq = event.seq; } onEvent(event); };
  const connect = (initial = false) => { const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:'; setConnection(false, initial ? 'Connecting…' : 'Reconnecting'); state.ws = new WebSocket(scheme + '//' + location.host + '/ws?token=' + encodeURIComponent(token)); state.ws.onopen = () => { const wasOffline = el.sessionSummary.textContent === 'Connection lost. Retrying…'; setConnection(true, 'Connected'); send({ type: 'resume', since: state.lastEventSeq }); if (state.terminalOpened && state.terminal) { const size = terminalSize(); send({ type: 'terminal_open', cols: size.cols, rows: size.rows }); if (wasOffline) { setSessionState('Connection restored.'); state.terminal.clear(); } send({ type: 'terminal_replay' }); } else if (wasOffline) setSessionState('Connection restored.'); }; state.ws.onmessage = (message) => { try { acceptEvent(JSON.parse(message.data)); } catch (_) {} }; state.ws.onclose = () => { setConnection(false, 'Reconnecting'); setSessionState('Connection lost. Retrying…'); clearTimeout(state.reconnect); state.reconnect = setTimeout(() => connect(false), 1500); }; state.ws.onerror = () => state.ws.close(); };
  document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => setView(button.dataset.view)));
  document.querySelectorAll('.suggestion').forEach((button) => button.addEventListener('click', () => { el.prompt.value = button.textContent; el.prompt.focus(); }));
  $('#composer').addEventListener('submit', (event) => { event.preventDefault(); runPrompt(); });
  el.prompt.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' && commandMatches.length) { event.preventDefault(); commandSelectedIndex = (commandSelectedIndex + 1) % commandMatches.length; renderCommandMenu(); return; }
    if (event.key === 'ArrowUp' && commandMatches.length) { event.preventDefault(); commandSelectedIndex = (commandSelectedIndex - 1 + commandMatches.length) % commandMatches.length; renderCommandMenu(); return; }
    if (event.key === 'Tab' && commandMatches.length) { event.preventDefault(); acceptCommand(commandMatches[commandSelectedIndex]); return; }
    if (event.key === 'Enter' && commandMatches.length && !event.shiftKey) { event.preventDefault(); acceptCommand(commandMatches[commandSelectedIndex]); runPrompt(); return; }
    if (event.key === 'Escape') { if (commandMatches.length) { event.preventDefault(); closeCommandMenu(); return; } stopAgent(); return; }
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); runPrompt(); }
  });
  el.prompt.addEventListener('input', () => { el.prompt.style.height = 'auto'; el.prompt.style.height = Math.min(el.prompt.scrollHeight, 180) + 'px'; commandSelectedIndex = 0; renderCommandMenu(); });
  el.prompt.addEventListener('blur', () => { setTimeout(closeCommandMenu, 120); });
  $('#mode-button').addEventListener('click', () => { const next = modes[(modes.indexOf(state.mode) + 1) % modes.length]; send({ type: 'set_mode', mode: next }); });
  stageAll.addEventListener('click', () => { const paths = state.source?.files.map((file) => file.path) || []; if (paths.length) send({ type: 'stage_files', paths }); });
  unstageAll.addEventListener('click', () => { const paths = state.source?.files.filter((file) => file.indexStatus !== ' ').map((file) => file.path) || []; if (paths.length) send({ type: 'unstage_files', paths }); });
  commitButton.addEventListener('click', showCommit);
  toolFilter.addEventListener('input', renderTools);
  document.addEventListener('keydown', (event) => { if (!(event.metaKey || event.ctrlKey)) return; const views = { '1': 'chat', '2': 'changes', '3': 'terminal' }; if (event.key.toLowerCase() === 'k') { event.preventDefault(); toolFilter.focus(); toolFilter.select(); return; } const view = views[event.key]; if (view) { event.preventDefault(); setView(view); } });
  $('#refresh').addEventListener('click', () => send({ type: 'refresh_source_control' })); $('#changes-refresh').addEventListener('click', () => send({ type: 'refresh_source_control' })); $('#activity-clear').addEventListener('click', () => { state.activity = []; renderActivity(); });
  document.querySelectorAll('[data-diff]').forEach((button) => button.addEventListener('click', () => { state.diffTab = button.dataset.diff; document.querySelectorAll('[data-diff]').forEach((tab) => tab.classList.toggle('active', tab.dataset.diff === state.diffTab)); renderSource(); }));
  $('#terminal-clear').addEventListener('click', () => { createTerminal()?.clear(); }); $('#terminal-reset').addEventListener('click', () => { const terminal = createTerminal(); if (!terminal) return; terminal.reset(); const size = terminalSize(); terminal.resize(size.cols, size.rows); send({ type: 'terminal_reset', cols: size.cols, rows: size.rows }); state.terminalOpened = true; terminal.focus(); });
  let resizingContext = false;
  contextResizer.addEventListener('pointerdown', (event) => { if (window.innerWidth <= 760) return; resizingContext = true; contextResizer.setPointerCapture(event.pointerId); document.body.classList.add('resizing-context'); });
  contextResizer.addEventListener('pointermove', (event) => { if (!resizingContext) return; const left = contextRail.getBoundingClientRect().left; setContextWidth(event.clientX - left); });
  const stopContextResize = () => { resizingContext = false; document.body.classList.remove('resizing-context'); };
  contextResizer.addEventListener('pointerup', stopContextResize); contextResizer.addEventListener('pointercancel', stopContextResize);
  contextResizer.addEventListener('keydown', (event) => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); const current = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--context-width')) || 390; setContextWidth(current + (event.key === 'ArrowRight' ? 24 : -24)); } });
  setInterval(updateHeartbeat, 1_000); setInterval(() => updateWelcomeContext(state.source), 1_000); restoreState(); updateWelcomeContext(state.source); renderActivity(); connect(true);
})();`;
