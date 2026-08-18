export const CLIENT_STYLES = String.raw`
:root {
  color-scheme: light;
  --canvas: #f7f8fb;
  --surface: #ffffff;
  --surface-soft: #f2f4f8;
  --surface-hover: #edf1f7;
  --surface-blue: #eef3ff;
  --line: #e4e7ed;
  --line-strong: #d5dae4;
  --text: #182033;
  --muted: #697386;
  --faint: #929aaa;
  --accent: #3159db;
  --accent-strong: #2445b4;
  --accent-wash: #eaf0ff;
  --warning: #a66b08;
  --danger: #bd4d45;
  --added: #238255;
  --removed: #bd4d45;
  --terminal: #151b29;
  --terminal-ink: #f2f5fb;
  --motion-instant: 90ms;
  --motion-fast: 160ms;
  --motion-base: 240ms;
  --ease-out: cubic-bezier(.16, 1, .3, 1);
  font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
* { box-sizing: border-box; }
html, body, #app { width: 100%; min-width: 320px; min-height: 100%; margin: 0; }
body { background: var(--canvas); color: var(--text); overflow: hidden; }
button, textarea, input { font: inherit; }
button { color: inherit; }
.skip-link { position: fixed; z-index: 10; left: 12px; top: 10px; padding: 8px 10px; transform: translateY(-160%); border-radius: 7px; background: var(--accent); color: #fff; font: 700 11px ui-monospace, monospace; transition: transform var(--motion-fast) var(--ease-out); }
.skip-link:focus { transform: translateY(0); }
.shell { display: grid; grid-template-columns: 244px minmax(0, 1fr) 284px; height: 100dvh; overflow: hidden; }
.sidebar { display: flex; flex-direction: column; min-width: 0; padding: 18px 12px 14px; background: #fbfcfe; border-right: 1px solid var(--line); }
.brand { display: flex; align-items: center; gap: 10px; padding: 0 9px 22px; }
.brand-mark { display: grid; place-items: center; width: 30px; height: 30px; color: var(--accent); }
.brand-mark .deepseek-logo { width: 30px; height: 30px; object-fit: contain; image-rendering: pixelated; }
.brand-name { color: var(--text); font-size: 15px; font-weight: 720; letter-spacing: -.03em; }
.brand-tag { display: none; }
.project { display: flex; gap: 10px; align-items: center; padding: 10px 9px; border: 1px solid var(--line); border-radius: 9px; background: var(--surface); }
.project-glyph { display: grid; place-items: center; flex: 0 0 auto; width: 28px; height: 28px; border-radius: 7px; background: var(--surface-blue); color: var(--accent); }
.project-glyph svg { width: 16px; height: 16px; }
.project-copy { min-width: 0; }
.project-name, .project-path { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.project-name { font-size: 12px; font-weight: 650; }
.project-path { margin-top: 2px; color: var(--muted); font: 10px/1.35 ui-monospace, monospace; }
.project-status { display: none; }
.nav { display: grid; gap: 2px; margin-top: 24px; }
.nav-label, .section-label { margin: 0 9px 8px; color: var(--faint); font-size: 10px; font-weight: 650; letter-spacing: .05em; text-transform: uppercase; }
.nav-button { position: relative; display: flex; align-items: center; gap: 10px; width: 100%; min-height: 37px; padding: 9px 10px; border: 0; border-radius: 7px; background: transparent; color: var(--muted); cursor: pointer; text-align: left; transition: color var(--motion-fast) var(--ease-out), background var(--motion-fast) var(--ease-out), transform var(--motion-instant) var(--ease-out); }
.nav-button:hover { background: var(--surface-hover); color: var(--text); }
.nav-button:active, .icon-button:active, .button:active { transform: translateY(1px); }
.nav-button.active { background: var(--surface-blue); color: var(--accent-strong); font-weight: 650; }
.nav-button.active::before { content: ""; position: absolute; left: -12px; width: 3px; height: 19px; border-radius: 0 3px 3px 0; background: var(--accent); }
.nav-button svg, .project-glyph svg, .branch svg { width: 16px; height: 16px; flex: 0 0 auto; }
.nav-count { margin-left: auto; padding: 1px 6px; border-radius: 99px; background: var(--surface-blue); color: var(--accent); font: 10px ui-monospace, monospace; }
.workspace-meta { margin-top: auto; padding: 13px 9px 6px; border-top: 1px solid var(--line); }
.branch { display: flex; gap: 7px; align-items: center; min-width: 0; color: var(--muted); font: 11px ui-monospace, monospace; }
.branch-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--accent); }
.branch-name { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.sync { margin-top: 6px; color: var(--faint); font: 10px ui-monospace, monospace; }
.main { display: flex; flex-direction: column; min-width: 0; background: var(--surface); }
.topbar { display: flex; align-items: center; justify-content: space-between; gap: 14px; height: 62px; padding: 0 25px; border-bottom: 1px solid var(--line); background: rgba(255,255,255,.92); }
.view-heading { display: flex; align-items: baseline; gap: 10px; min-width: 0; }
.view-heading::before { display: none; }
.view-title { margin: 0; color: var(--text); font-size: 14px; font-weight: 700; letter-spacing: -.02em; }
.view-subtitle { overflow: hidden; color: var(--muted); font: 11px ui-monospace, monospace; text-overflow: ellipsis; white-space: nowrap; }
.topbar-actions { display: flex; align-items: center; gap: 9px; }
.connection { display: inline-flex; align-items: center; gap: 6px; color: var(--muted); font: 10px ui-monospace, monospace; }
.connection::before { content: ""; width: 6px; height: 6px; border-radius: 99px; background: var(--faint); }
.connection.online::before { background: var(--added); }
.connection.error::before { background: var(--danger); }
.icon-button { display: grid; place-items: center; width: 30px; height: 30px; padding: 0; border: 1px solid var(--line); border-radius: 7px; background: var(--surface); color: var(--muted); cursor: pointer; transition: color var(--motion-fast) var(--ease-out), border-color var(--motion-fast) var(--ease-out), background var(--motion-fast) var(--ease-out), transform var(--motion-instant) var(--ease-out); }
.icon-button:hover { border-color: var(--line-strong); background: var(--surface-hover); color: var(--text); }
.icon-button svg { width: 15px; height: 15px; }
.content { display: grid; position: relative; grid-template-columns: 0 minmax(0, 1fr); flex: 1; min-height: 0; overflow: hidden; transition: grid-template-columns var(--motion-base) var(--ease-out); }
.view { display: none; width: 100%; min-height: 0; flex: 1 1 auto; }
.view.active { display: flex; }
.chat-view { grid-column: 2; flex-direction: column; }
.context-rail { position: relative; display: flex; grid-column: 1; min-width: 0; min-height: 0; overflow: hidden; border-right: 1px solid var(--line); background: var(--surface-soft); }
.context-rail:not(.open) { display: none; }
.context-resizer { position: absolute; z-index: 2; top: 0; right: -3px; bottom: 0; width: 6px; cursor: col-resize; touch-action: none; }
.context-resizer::after { content: ""; position: absolute; top: 50%; left: 2px; width: 2px; height: 42px; border-radius: 2px; background: var(--line-strong); transform: translateY(-50%); opacity: 0; transition: opacity var(--motion-fast) var(--ease-out); }
.context-resizer:hover::after, .context-resizer:focus-visible::after, body.resizing-context .context-resizer::after { opacity: 1; background: var(--accent); }
.main.context-open .content { grid-template-columns: var(--context-width, 390px) minmax(0, 1fr); }
.main.context-open .chat-view { grid-column: 2; min-width: 0; border-left: 1px solid var(--line); }
.main.context-open .context-rail { grid-column: 1 / -1; }
.main.context-open .chat-view { display: none; }
.conversation { flex: 1; min-height: 0; overflow-y: auto; scrollbar-width: thin; padding: 38px clamp(20px, 6vw, 92px) 28px; }
.conversation-inner { position: relative; max-width: 780px; margin: 0 auto; }
.conversation-inner::before { display: none; }
.welcome { position: relative; max-width: 650px; margin: 13vh auto 0; animation: rise var(--motion-base) var(--ease-out) both; }
@keyframes rise { from { opacity: 0; transform: translateY(7px); } to { opacity: 1; transform: translateY(0); } }
.eyebrow { color: var(--accent); font-size: 11px; font-weight: 700; letter-spacing: .01em; }
.welcome h2 { max-width: 600px; margin: 13px 0 10px; color: var(--text); font-size: clamp(32px, 4.3vw, 52px); line-height: 1.02; letter-spacing: -.065em; }
.welcome p { max-width: 560px; margin: 0; color: var(--muted); font-size: 15px; line-height: 1.65; }
.workbench-strip { display: flex; gap: 8px; max-width: 680px; margin-top: 31px; }
.workbench-strip > div { display: grid; gap: 3px; min-width: 0; padding: 10px 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); }
.workbench-strip span { color: var(--accent); font: 10px ui-monospace, monospace; }
.workbench-strip strong { color: var(--text); font-size: 10px; font-weight: 700; }
.workbench-strip small { color: var(--faint); font-size: 10px; }
.suggestions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 23px; }
.suggestion { padding: 8px 11px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); color: var(--muted); font-size: 11px; cursor: pointer; transition: border-color var(--motion-fast), background var(--motion-fast), color var(--motion-fast); }
.suggestion:hover { border-color: #b8c5e5; background: var(--surface-blue); color: var(--accent-strong); }
.message { position: relative; display: grid; grid-template-columns: 27px minmax(0, 1fr); gap: 12px; margin: 0 0 24px; animation: rise var(--motion-fast) var(--ease-out) both; }
.message-mark { z-index: 1; display: grid; place-items: center; width: 27px; height: 27px; margin-top: 1px; border: 1px solid var(--line); border-radius: 50%; background: var(--surface); color: var(--accent); font: 700 11px ui-monospace, monospace; }
.message.assistant .message-mark { padding: 5px; border-color: transparent; background: var(--surface-blue); }
.message-mark .deepseek-logo { width: 17px; height: 17px; object-fit: contain; image-rendering: pixelated; }
.message.user .message-mark { background: var(--text); color: #fff; }
.message-body { min-width: 0; }
.message-label { margin-bottom: 5px; color: var(--muted); font: 10px ui-monospace, monospace; }
.message-content { overflow-wrap: anywhere; color: var(--text); font-size: 14px; line-height: 1.7; }
.message-line { min-height: 1.7em; white-space: pre-wrap; }
.message-heading { margin: 15px 0 4px; color: var(--text); font-size: 15px; font-weight: 700; letter-spacing: -.01em; }
.message-list-item { position: relative; min-height: 1.7em; padding-left: 15px; white-space: pre-wrap; }
.message-list-item::before { content: ""; position: absolute; left: 3px; top: .75em; width: 4px; height: 4px; border-radius: 50%; background: var(--accent); }
.message-inline-code { padding: 1px 4px; border: 1px solid #d9e2ff; border-radius: 4px; background: var(--surface-blue); color: var(--accent-strong); font: .91em ui-monospace, monospace; }
.message-code { overflow: auto; margin: 11px 0; padding: 14px; border: 1px solid #2a3550; border-radius: 9px; background: var(--terminal); color: #e8edf8; font: 11px/1.65 ui-monospace, monospace; tab-size: 2; white-space: pre; }
.message.thinking .message-content { color: var(--muted); font-style: italic; }
.tool-row { display: flex; align-items: center; gap: 8px; margin: 0 0 12px 39px; padding: 8px 10px; border-left: 2px solid var(--line-strong); background: var(--surface-soft); color: var(--muted); font: 11px/1.45 ui-monospace, monospace; }
.tool-row.running { border-color: var(--accent); }
.tool-name, .tool-card-name { color: var(--accent-strong); font-weight: 650; }
.tool-args { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.composer-wrap { padding: 10px clamp(20px, 6vw, 92px) 25px; }
.composer { max-width: 780px; margin: 0 auto; border: 1px solid var(--line-strong); border-radius: 15px; background: var(--surface); box-shadow: 0 10px 30px rgba(27,43,78,.08), 0 1px 2px rgba(27,43,78,.04); transition: border-color var(--motion-fast), box-shadow var(--motion-fast); }
.composer:focus-within { border-color: #9eb0e2; box-shadow: 0 12px 34px rgba(49,89,219,.12), 0 0 0 3px rgba(49,89,219,.08); }
.composer-caption { display: flex; justify-content: space-between; padding: 12px 14px 0; color: var(--faint); font-size: 10px; }
.composer textarea { display: block; width: 100%; min-height: 67px; max-height: 180px; padding: 10px 14px 6px; resize: none; outline: none; border: 0; background: transparent; color: var(--text); font: 14px/1.55 inherit; }
.composer textarea::placeholder { color: var(--faint); }
.composer-foot { display: flex; align-items: center; justify-content: space-between; min-height: 35px; padding: 0 9px 9px 12px; }
.mode-button { display: inline-flex; align-items: center; gap: 6px; padding: 5px 7px; border: 0; border-radius: 6px; background: transparent; color: var(--muted); font: 11px ui-monospace, monospace; cursor: pointer; }
.mode-button:hover { background: var(--surface-blue); color: var(--accent-strong); }
.mode-dot { width: 6px; height: 6px; border-radius: 99px; background: var(--accent); }
.send-button { display: inline-grid; place-items: center; width: 31px; height: 31px; border: 0; border-radius: 9px; background: var(--accent); color: #fff; cursor: pointer; transition: transform var(--motion-instant), background var(--motion-fast); }
.send-button:hover { background: var(--accent-strong); }
.send-button.stop-button { background: var(--danger); }
.send-button.stop-button:hover { background: #a63f3a; }
.send-button:disabled { cursor: default; background: var(--line-strong); color: #fff; }
.send-button svg { width: 14px; height: 14px; }
.rightbar { display: flex; flex-direction: column; min-width: 0; overflow-y: auto; scrollbar-width: thin; background: #fbfcfe; border-left: 1px solid var(--line); }
.right-section { padding: 19px 17px; border-bottom: 1px solid var(--line); }
.right-section.fill { display: flex; flex: 1 1 auto; flex-direction: column; min-height: 170px; }
.right-heading { display: flex; align-items: center; justify-content: space-between; margin-bottom: 11px; color: var(--text); font-size: 11px; font-weight: 700; letter-spacing: 0; }
.right-heading button { border: 0; background: transparent; color: var(--muted); cursor: pointer; font-size: 10px; }
.right-heading button:hover { color: var(--accent); }
.session-panel { min-height: 108px; background: var(--surface); }
.session-state { display: flex; align-items: flex-start; gap: 8px; color: var(--muted); font: 11px/1.5 ui-monospace, monospace; }
.session-state-dot { flex: 0 0 auto; width: 7px; height: 7px; margin-top: 4px; border-radius: 50%; background: var(--faint); }
.session-state.busy .session-state-dot { background: var(--accent); box-shadow: 0 0 0 4px var(--accent-wash); }
.activity-list { display: grid; gap: 2px; overflow-y: auto; }
.activity-item { padding: 8px 7px; border-radius: 7px; border-left: 2px solid transparent; }
.activity-item:hover { background: var(--surface-hover); }
.activity-item.active { border-left-color: var(--accent); background: var(--surface-blue); }
.activity-top { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; color: var(--text); font: 11px ui-monospace, monospace; }
.activity-tool { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.activity-state { color: var(--faint); font-size: 9px; }
.activity-detail { margin-top: 4px; overflow: hidden; color: var(--muted); font: 10px/1.4 ui-monospace, monospace; text-overflow: ellipsis; white-space: nowrap; }
.activity-pulse { display: none; }
.empty { color: var(--faint); font-size: 11px; line-height: 1.6; }
.tool-catalog { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px; }
.tool-filter { width: 100%; margin: 0 0 8px; padding: 8px 9px; border: 1px solid var(--line); border-radius: 8px; outline: none; background: var(--surface); color: var(--text); font: 10px ui-monospace, monospace; }
.tool-filter::placeholder { color: var(--faint); }
.tool-filter:focus { border-color: #9eb0e2; box-shadow: 0 0 0 3px var(--accent-wash); }
.tool-empty { grid-column: 1 / -1; padding: 6px 2px; }
.tool-pill { overflow: hidden; width: 100%; padding: 6px 7px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: var(--muted); cursor: pointer; font: 9px ui-monospace, monospace; text-align: left; text-overflow: ellipsis; white-space: nowrap; }
.tool-pill:hover { border-color: #b8c5e5; background: var(--surface-blue); color: var(--accent-strong); }
.tool-details-name { color: var(--accent-strong); font: 700 12px ui-monospace, monospace; }
.tool-details-description { margin: 10px 0 0; color: var(--text); font-size: 13px; line-height: 1.7; }
.changes-view { min-height: 0; grid-template-columns: minmax(190px, 29%) minmax(0, 1fr); }
.changes-view.active { display: grid; }
.changes-list { overflow-y: auto; border-right: 1px solid var(--line); padding: 20px 11px; background: var(--surface-soft); }
.changes-heading { display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: 5px; padding: 0 7px 13px; color: var(--muted); font: 10px ui-monospace, monospace; }
.changes-heading::before { content: "Changes"; flex: 1 0 100%; margin-right: 0; color: var(--text); font: 700 11px Inter, sans-serif; }
.changes-heading > span { display: none; }
.changes-action { padding: 5px 7px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); font-size: 9px; }
.changes-action:disabled { opacity: .35; cursor: default; }
.changes-action.primary-action { border-color: #b8c5e5; background: var(--surface-blue); color: var(--accent-strong); }
.changes-group { margin-top: 13px; }
.changes-group-title { display: flex; justify-content: space-between; padding: 0 7px 5px; color: var(--faint); font: 9px ui-monospace, monospace; letter-spacing: .04em; text-transform: uppercase; }
.change-file { display: grid; grid-template-columns: 18px minmax(0, 1fr) 20px; gap: 6px; align-items: center; width: 100%; padding: 7px; border: 0; border-radius: 6px; background: transparent; color: var(--muted); cursor: pointer; text-align: left; }
.change-file:hover, .change-file.selected { background: var(--surface); color: var(--text); }
.change-status { font: 10px ui-monospace, monospace; text-align: center; }
.change-status.add { color: var(--added); }.change-status.remove { color: var(--removed); }.change-status.modify { color: var(--warning); }
.change-path { overflow: hidden; font: 11px ui-monospace, monospace; text-overflow: ellipsis; white-space: nowrap; }
.stage-toggle { width: 16px; height: 16px; padding: 0; border: 1px solid var(--line-strong); border-radius: 4px; background: transparent; color: var(--accent); cursor: pointer; }
.stage-toggle.staged { border-color: var(--accent); background: var(--accent-wash); }
.diff-pane { display: flex; flex-direction: column; min-width: 0; }
.diff-toolbar { display: flex; align-items: center; justify-content: space-between; min-height: 47px; padding: 0 18px; border-bottom: 1px solid var(--line); }
.diff-file-title { overflow: hidden; color: var(--text); font: 11px ui-monospace, monospace; text-overflow: ellipsis; white-space: nowrap; }
.diff-tabs { display: flex; gap: 2px; }.diff-tab { padding: 6px 8px; border: 0; border-radius: 6px; background: transparent; color: var(--faint); font: 10px ui-monospace, monospace; cursor: pointer; }.diff-tab.active { background: var(--surface-blue); color: var(--accent-strong); }
.diff { flex: 1; min-width: 0; min-height: 0; overflow: auto; padding: 18px 0 40px; background: var(--surface); color: var(--text); font: 11px/1.6 ui-monospace, monospace; tab-size: 2; }
.diff-line { display: grid; grid-template-columns: 44px 44px minmax(0, 1fr); min-width: 0; white-space: normal; }.diff-line.add { background: #eef9f2; color: var(--added); }.diff-line.remove { background: #fff2f1; color: var(--removed); }.diff-line.hunk { margin-top: 8px; background: var(--surface-blue); color: var(--accent-strong); }.diff-line.meta { color: var(--faint); }
.diff-num { align-self: start; padding-right: 8px; color: var(--faint); text-align: right; user-select: none; }.diff-code { min-width: 0; padding-right: 20px; white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word; }
.diff-empty { display: grid; place-items: center; height: 100%; padding: 40px; color: var(--faint); text-align: center; font-size: 12px; }
.terminal-view { flex: 1 1 0; flex-direction: column; min-height: 0; height: 100%; overflow: hidden; background: var(--surface); }
.terminal-toolbar { display: flex; align-items: center; justify-content: space-between; min-height: 54px; padding: 0 19px; border-bottom: 1px solid var(--line); background: var(--surface); }
.terminal-title { display: flex; align-items: center; gap: 8px; color: var(--text); font-size: 12px; font-weight: 650; }.terminal-live { width: 7px; height: 7px; border-radius: 50%; background: var(--added); }
.terminal-actions { display: flex; gap: 7px; }.button { padding: 6px 9px; border: 1px solid var(--line); border-radius: 7px; background: var(--surface); color: var(--muted); cursor: pointer; font: 10px ui-monospace, monospace; }.button:hover { border-color: var(--line-strong); background: var(--surface-hover); color: var(--text); }
.terminal-host { flex: 1 1 0; min-height: 0; height: 0; overflow: hidden; margin: 16px 18px 18px; padding: 14px 16px 22px; border: 1px solid #2b3854; border-radius: 12px; background: var(--terminal); box-shadow: 0 10px 25px rgba(24,32,51,.08); }
.terminal-host .xterm { height: 100%; min-height: 0; }.terminal-host .xterm-viewport { background: var(--terminal) !important; scrollbar-color: #4d5c78 var(--terminal); }.terminal-host .xterm-screen canvas { image-rendering: auto; }
.tool-card { margin: 0 0 12px 39px; overflow: hidden; border: 1px solid var(--line); border-left: 2px solid var(--line-strong); border-radius: 8px; background: var(--surface); animation: rise var(--motion-fast) var(--ease-out) both; }.tool-card.running { border-left-color: var(--accent); }.tool-card-head { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 38px; padding: 7px 10px; border: 0; background: transparent; color: var(--muted); cursor: pointer; text-align: left; font: 11px/1.45 ui-monospace, monospace; }.tool-card-head:hover { background: var(--surface-hover); }.tool-status { flex: 0 0 auto; width: 12px; height: 12px; border: 1.5px solid var(--line-strong); border-radius: 50%; }.tool-card.running .tool-status { border-color: transparent; border-top-color: var(--accent); border-right-color: var(--accent); animation: spin .9s linear infinite; }@keyframes spin { to { transform: rotate(360deg); } }.tool-card:not(.running) .tool-status { border-color: var(--added); background: radial-gradient(circle at center, var(--added) 0 3px, transparent 3.5px); }.tool-card-icon { display: grid; place-items: center; flex: 0 0 auto; width: 20px; height: 20px; border-radius: 5px; background: var(--surface-blue); color: var(--accent); }.tool-card-icon svg { width: 12px; height: 12px; }.tool-card-preview { overflow: hidden; min-width: 0; text-overflow: ellipsis; white-space: nowrap; }.tool-card-head::after { content: "▾"; flex: 0 0 auto; margin-left: auto; color: var(--faint); font-size: 9px; transition: transform var(--motion-fast) var(--ease-out); }.tool-card.open .tool-card-head::after { transform: rotate(180deg); }.tool-card-body { display: none; padding: 0 10px 10px; }.tool-card.open .tool-card-body { display: grid; gap: 8px; }.tool-card-args, .tool-card-output, .inline-diff, .todo-checklist { max-width: 100%; overflow: auto; margin: 0; padding: 9px 10px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface-soft); color: var(--muted); font: 10px/1.55 ui-monospace, monospace; white-space: pre-wrap; overflow-wrap: anywhere; }.tool-card-output.long { max-height: 260px; }.tool-card-output.expanded { max-height: none; }.tool-card-more { justify-self: start; padding: 3px 8px; border: 1px solid var(--line); border-radius: 5px; background: transparent; color: var(--muted); cursor: pointer; font: 9px ui-monospace, monospace; }.tool-card-summary { color: var(--faint); font: 10px/1.4 ui-monospace, monospace; }.inline-diff-line { padding: 0 10px; white-space: pre-wrap; overflow-wrap: anywhere; }.inline-diff-line.add { background: #eef9f2; color: var(--added); }.inline-diff-line.remove { background: #fff2f1; color: var(--removed); text-decoration: line-through; }.inline-diff-line.hunk { margin-top: 4px; background: var(--surface-blue); color: var(--accent-strong); }.todo-checklist { display: grid; gap: 2px; }.todo-item { color: var(--muted); font: 10px/1.5 ui-monospace, monospace; white-space: pre-wrap; }.todo-item.in_progress { color: var(--accent-strong); }.todo-item.done { color: var(--faint); text-decoration: line-through; }
.telemetry-panel .context-bar { height: 5px; margin: 2px 0 12px; overflow: hidden; border-radius: 99px; background: var(--surface-soft); }.context-fill { height: 100%; width: 0; border-radius: inherit; background: var(--accent); transition: width var(--motion-base) var(--ease-out), background var(--motion-base) var(--ease-out); }.context-fill.warn { background: var(--warning); }.context-fill.crit { background: var(--danger); }.telemetry-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1px; overflow: hidden; border: 1px solid var(--line); border-radius: 8px; background: var(--line); }.telemetry-cell { display: grid; gap: 2px; min-height: 44px; padding: 8px 9px; background: var(--surface); }.telemetry-cell small { color: var(--faint); font-size: 8px; text-transform: uppercase; }.telemetry-cell strong { overflow: hidden; color: var(--text); font: 11px ui-monospace, monospace; text-overflow: ellipsis; white-space: nowrap; }#context-pct { color: var(--accent); font: 10px ui-monospace, monospace; }.todos-list { display: grid; gap: 2px; margin: 0; padding: 0; list-style: none; }.todos-item { display: flex; gap: 8px; align-items: baseline; padding: 5px 6px; border-radius: 5px; color: var(--muted); font: 11px/1.45 ui-monospace, monospace; }.todos-item:hover { background: var(--surface-hover); }.todos-mark { flex: 0 0 auto; color: var(--faint); font-size: 10px; }.todos-item.current { color: var(--text); }.todos-item.current .todos-mark { color: var(--accent); }.todos-item.done { color: var(--faint); text-decoration: line-through; }
.modal-layer { position: fixed; inset: 0; z-index: 3; display: none; align-items: center; justify-content: center; padding: 20px; background: rgba(24,32,51,.35); backdrop-filter: blur(5px); }.modal-layer.open { display: flex; }.modal { width: min(620px, 100%); max-height: min(720px, calc(100dvh - 40px)); overflow: auto; border: 1px solid var(--line-strong); border-radius: 14px; background: var(--surface); box-shadow: 0 25px 70px rgba(24,32,51,.18); }.modal-header { padding: 18px 19px 12px; border-bottom: 1px solid var(--line); }.modal-title { margin: 0; font-size: 15px; }.modal-subtitle { margin-top: 5px; color: var(--muted); font-size: 11px; line-height: 1.55; }.modal-body { padding: 17px 19px; }.modal pre { max-height: 250px; overflow: auto; margin: 0; padding: 10px; border-radius: 7px; background: var(--terminal); color: #d9e0ef; font: 10px/1.5 ui-monospace, monospace; white-space: pre-wrap; }.modal-actions { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 19px 18px; }.action { padding: 7px 10px; border: 1px solid var(--line-strong); border-radius: 7px; background: var(--surface); color: var(--muted); cursor: pointer; font-size: 11px; }.action:hover { background: var(--surface-hover); color: var(--text); }.action.primary { border-color: var(--accent); background: var(--accent); color: #fff; font-weight: 700; }.action.danger { border-color: #e2aaa6; color: var(--danger); }.question { padding: 12px 0; border-bottom: 1px solid var(--line); }.question:first-child { padding-top: 0; }.question:last-child { border-bottom: 0; }.question-title { font-size: 12px; }.question-header { color: var(--accent); font: 10px ui-monospace, monospace; }.question-options { display: grid; gap: 5px; margin-top: 9px; }.choice { display: flex; gap: 7px; align-items: baseline; padding: 8px; border: 1px solid var(--line); border-radius: 7px; color: var(--muted); font-size: 11px; cursor: pointer; }.choice:has(input:checked) { border-color: #9eb0e2; background: var(--surface-blue); color: var(--text); }.choice input { accent-color: var(--accent); }.choice small { color: var(--faint); }.question-text { width: 100%; margin-top: 8px; padding: 8px; border: 1px solid var(--line); border-radius: 7px; outline: none; background: var(--surface); color: var(--text); font-size: 12px; }.question-text:focus { border-color: var(--accent); }
button:focus-visible, textarea:focus-visible, input:focus-visible, [tabindex]:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }.composer textarea:focus-visible { outline: none; outline-offset: 0; }
.main.context-open .chat-view .conversation { padding-inline: clamp(16px, 3vw, 34px); }.main.context-open .chat-view .welcome { margin-top: 7vh; }.main.context-open .changes-view, .main.context-open .terminal-view { min-width: 0; }.main.context-open .composer-wrap { padding-inline: clamp(16px, 3vw, 34px); }
body[data-connection="offline"] .composer { border-color: #e2aaa6; } body[data-connection="offline"] .composer-caption span:last-child { color: var(--danger); }.activity-item.pending .activity-marker { border-style: dashed; color: var(--muted); }.activity-item.pending .activity-state { border-color: var(--line); color: var(--muted); }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; scroll-behavior: auto !important; transition-duration: .01ms !important; } }
@media (max-width: 1140px) { .shell { grid-template-columns: 230px minmax(0, 1fr); }.rightbar { display: none; } }
@media (max-width: 760px) { body { overflow: auto; }.shell { display: flex; flex-direction: column; height: 100dvh; }.sidebar { order: 2; flex: 0 0 auto; height: 58px; padding: 6px 8px; border-top: 1px solid var(--line); border-right: 0; }.brand, .project, .workspace-meta, .nav-label { display: none; }.nav { display: flex; justify-content: space-around; gap: 4px; width: 100%; margin: 0; }.nav-button { justify-content: center; width: auto; min-width: 44px; min-height: 44px; padding: 9px 11px; }.nav-button span:not(.nav-count) { display: none; }.nav-button.active::before { top: auto; bottom: -6px; left: 50%; width: 16px; height: 2px; transform: translateX(-50%); }.nav-count { position: absolute; top: 2px; right: 1px; }.main { min-height: 0; }.topbar { height: 54px; padding: 0 15px; }.view-subtitle { display: none; }.conversation { padding: 24px 15px 12px; }.welcome { margin-top: 8vh; }.welcome h2 { font-size: clamp(32px, 11vw, 46px); }.workbench-strip { display: grid; grid-template-columns: 1fr; margin-top: 24px; }.workbench-strip > div { min-height: 53px; }.composer-wrap { padding: 8px 12px 12px; }.composer-caption { padding-top: 9px; }.changes-view { grid-template-columns: 135px minmax(0, 1fr); }.changes-list { padding: 14px 6px; }.diff-toolbar { padding: 0 10px; }.diff { font-size: 10px; }.diff-line { grid-template-columns: 33px 33px minmax(max-content, 1fr); }.terminal-host { margin: 12px; padding: 12px 13px 18px; } }
@media (max-width: 760px) { .content, .main.context-open .content { grid-template-columns: minmax(0, 1fr); }.chat-view { grid-column: 1; }.context-rail { grid-column: 1; border-right: 0; }.context-resizer { display: none; }.diff-line { grid-template-columns: 33px 33px minmax(0, 1fr); }.main.context-open .chat-view { display: none; }.main.context-open .changes-view, .main.context-open .terminal-view { flex: 1 1 auto; border-right: 0; } }
/* Editorial workbench direction: one active blue signal inside a dark spine, paper field, and instrument rail. */
:root {
  --canvas: #e9e7e1;
  --surface: #fbfaf7;
  --surface-soft: #f1f0eb;
  --surface-hover: #e7ebf2;
  --surface-blue: #e8efff;
  --line: #d9d8d2;
  --line-strong: #bdc3cc;
  --text: #17202d;
  --muted: #69717d;
  --faint: #969da6;
  --accent: #1f5cff;
  --accent-strong: #1642b7;
  --accent-wash: #dce7ff;
  --terminal: #111722;
  --terminal-ink: #f3f5fa;
  --font-display: "Iowan Old Style", "Palatino Linotype", Georgia, serif;
  --font-ui: Inter, "Avenir Next", "Segoe UI", sans-serif;
  font-family: var(--font-ui);
}
body { background: var(--canvas); color: var(--text); }
.shell { grid-template-columns: 232px minmax(0, 1fr) 310px; background: var(--canvas); }
.sidebar { padding: 22px 14px 16px; border-right: 0; background: #111722; color: #edf1f8; }
.brand { gap: 11px; padding: 0 10px 27px; }
.brand-mark { width: 32px; height: 32px; }
.brand-mark .deepseek-logo { width: 32px; height: 32px; }
.brand-name { color: #f4f6fb; font: 700 15px/1 var(--font-ui); letter-spacing: -.035em; }
.project { padding: 12px 10px; border-color: #2a3445; border-radius: 8px; background: #192130; box-shadow: inset 0 1px rgba(255,255,255,.03); }
.project-glyph { background: #202d42; color: #7da0ff; }
.project-name { color: #f2f4f8; }
.project-path { color: #8e99aa; }
.nav { margin-top: 31px; gap: 5px; }
.nav-label, .section-label { margin: 0 10px 10px; color: #748094; font: 700 9px/1 var(--font-ui); letter-spacing: .16em; }
.nav-button { min-height: 40px; padding: 10px 11px; border-radius: 6px; color: #9ca8b9; font: 500 12px/1 var(--font-ui); }
.nav-button:hover { background: #1b2636; color: #fff; }
.nav-button.active { background: #1c3978; color: #fff; }
.nav-button.active::before { left: -14px; width: 4px; height: 24px; background: var(--accent); }
.nav-count { background: #263e75; color: #bcd0ff; }
.workspace-meta { padding: 15px 10px 5px; border-top-color: #2a3445; }
.branch { color: #9ca8b9; }
.branch-dot { background: var(--accent); box-shadow: 0 0 0 4px rgba(31,92,255,.16); }
.sync { color: #68758a; }
.main { background: var(--surface); }
.topbar { height: 70px; padding: 0 29px; border-bottom-color: var(--line); background: rgba(251,250,247,.94); }
.view-heading { gap: 12px; }
.view-title { color: var(--text); font: 700 18px/1 var(--font-display); letter-spacing: -.035em; }
.view-subtitle { color: var(--muted); font: 10px/1.2 ui-monospace, monospace; }
.topbar-actions { gap: 13px; }
.connection { color: var(--muted); font-size: 10px; }
.icon-button { width: 32px; height: 32px; border-radius: 6px; background: transparent; border-color: var(--line); }
.content { background-color: var(--surface); }
.conversation { padding: 49px clamp(28px, 6vw, 96px) 32px; }
.conversation-inner { max-width: 900px; }
.welcome { max-width: 860px; margin: 7vh 0 0; }
.eyebrow { color: var(--accent-strong); font: 700 10px/1 var(--font-ui); letter-spacing: .13em; text-transform: uppercase; }
.welcome h2 { max-width: 730px; margin: 14px 0 14px; font: 400 clamp(42px, 5.4vw, 72px)/.98 var(--font-display); letter-spacing: -.07em; }
.welcome p { max-width: 650px; color: #66707d; font: 15px/1.7 var(--font-ui); }
.workspace-brief { position: relative; max-width: 820px; margin-top: 42px; padding: 16px 0 0 22px; border-top: 1px solid var(--line-strong); border-bottom: 1px solid var(--line); }
.workspace-brief::before { position: absolute; top: -1px; left: 0; width: 5px; height: 62px; background: var(--accent); content: ""; }
.brief-head, .brief-footer { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.brief-head { color: var(--muted); font: 700 9px/1 ui-monospace, monospace; letter-spacing: .15em; }
.brief-index { color: var(--accent-strong); }
.brief-main { display: grid; grid-template-columns: 166px minmax(0, 1fr); gap: 26px; align-items: center; min-height: 176px; }
.brief-orbit { position: relative; display: grid; place-items: center; width: 142px; height: 142px; border: 1px solid #b7c0ce; border-radius: 50%; background: radial-gradient(circle at 50% 48%, #fff 0 31%, transparent 32%), linear-gradient(135deg, rgba(31,92,255,.08), transparent 64%); color: var(--accent-strong); }
.brief-orbit-ring { position: absolute; inset: 17px; border: 1px solid #a9b7d2; border-radius: 50%; transform: rotate(-23deg) skewX(-18deg); }
.brief-orbit-ring-small { inset: 34px; border-color: rgba(31,92,255,.45); transform: rotate(42deg) skewX(18deg); }
.brief-orbit-node { position: absolute; width: 8px; height: 8px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 0 5px rgba(31,92,255,.13); }
.brief-orbit-node-one { top: 19px; right: 27px; }
.brief-orbit-node-two { bottom: 25px; left: 23px; background: #17202d; box-shadow: none; }
.brief-orbit strong { position: relative; margin-top: 4px; font: 700 38px/.9 ui-monospace, monospace; letter-spacing: -.08em; }
.brief-orbit small { position: absolute; bottom: 31px; color: var(--muted); font: 9px/1 ui-monospace, monospace; text-transform: uppercase; }
.brief-copy > span { color: var(--accent-strong); font: 700 10px/1 ui-monospace, monospace; text-transform: uppercase; }
.brief-copy strong { display: block; margin-top: 9px; font: 400 30px/.95 var(--font-display); letter-spacing: -.05em; }
.brief-copy p { max-width: 390px; margin: 11px 0 0; color: var(--muted); font: 12px/1.55 ui-monospace, monospace; }
.brief-footer { min-height: 63px; border-top: 1px solid var(--line); }
.brief-footer > span { color: var(--muted); font: 10px ui-monospace, monospace; }
.suggestions { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0; margin-top: 0; }
.suggestion { min-height: 45px; padding: 9px 12px; border: 0; border-left: 1px solid var(--line); border-radius: 0; background: transparent; color: var(--muted); font: 600 10px/1.25 var(--font-ui); text-align: left; transition: color var(--motion-fast) var(--ease-out), background var(--motion-fast) var(--ease-out), transform var(--motion-fast) var(--ease-out); }
.suggestion:hover { background: var(--accent-wash); color: var(--accent-strong); transform: translateY(-2px); }
.composer-wrap { padding: 10px clamp(28px, 6vw, 96px) 28px; }
.composer { max-width: 900px; border-color: #b9bec5; border-radius: 9px; background: rgba(255,255,255,.72); box-shadow: 0 15px 30px rgba(30,38,49,.06); }
.composer:focus-within { border-color: var(--accent); box-shadow: 0 15px 32px rgba(31,92,255,.1), 0 0 0 3px rgba(31,92,255,.08); }
.composer-caption { padding: 12px 15px 0; color: #8c939b; font: 9px ui-monospace, monospace; }
.composer textarea { font-family: var(--font-ui); }
.composer-foot { min-height: 40px; }
.mode-button { border-radius: 4px; font-size: 10px; }
.mode-button:hover { background: var(--accent-wash); }
.mode-dot { background: var(--accent); box-shadow: 0 0 0 4px rgba(31,92,255,.12); }
.send-button { width: 33px; height: 33px; border-radius: 7px; background: var(--accent); box-shadow: 0 4px 10px rgba(31,92,255,.25); }
.rightbar { background: #e8ebef; border-left-color: #cfd3d8; }
.right-section { padding: 19px 18px; border-bottom: 1px solid #d1d5da; }
.right-heading { margin-bottom: 13px; color: var(--text); font: 700 10px/1 var(--font-ui); letter-spacing: .09em; text-transform: uppercase; }
.right-heading button { font: 700 9px ui-monospace, monospace; text-transform: uppercase; }
.session-panel { min-height: 122px; background: #151d2a; color: #f3f5fa; }
.session-panel .right-heading { color: #fff; }
.session-panel .right-heading span:last-child { color: #8ea9ff; }
.session-state { color: #b7c0cf; }
.session-state-dot { background: var(--accent); box-shadow: 0 0 0 4px rgba(31,92,255,.17); animation: signalPulse 2.6s ease-in-out infinite; }
.session-state.busy .session-state-dot { background: #78a0ff; }
.session-heartbeat { margin-top: 11px; color: #758196; font: 9px ui-monospace, monospace; }
.telemetry-panel { padding-top: 22px; background: #eef0f2; }
.telemetry-panel .context-bar { height: 6px; margin: 4px 0 15px; background: #d7dce3; }
.telemetry-grid { grid-template-columns: 1.2fr .8fr; gap: 1px; border: 0; border-radius: 0; background: #cfd4dc; }
.telemetry-cell { min-height: 52px; padding: 10px; background: #f8f8f6; }
.telemetry-cell:first-child { grid-column: 1 / -1; min-height: 74px; background: #1a2433; }
.telemetry-cell:first-child small, .telemetry-cell:first-child strong { color: #dfe6f4; }
.telemetry-cell small { color: #87909c; font: 8px ui-monospace, monospace; letter-spacing: .1em; }
.telemetry-cell strong { font: 12px ui-monospace, monospace; font-variant-numeric: tabular-nums; }
#context-pct { color: var(--accent-strong); }
.todos-panel { background: #eef0f2; }
.todos-list { gap: 0; }
.todos-item { padding: 7px 5px; border-bottom: 1px solid #d8dce1; border-radius: 0; }
.right-section.fill { min-height: 230px; background: #e4e7eb; }
.activity-list { gap: 0; padding-left: 12px; border-left: 1px solid #bcc5d0; }
.activity-item { position: relative; display: grid; grid-template-columns: 16px minmax(0, 1fr); gap: 7px; padding: 9px 4px 9px 8px; border-radius: 0; border-left: 0; }
.activity-item::before { position: absolute; top: 16px; left: -16px; width: 7px; height: 7px; border: 2px solid #e4e7eb; border-radius: 50%; background: #9aa4b1; content: ""; }
.activity-item.active::before { background: var(--accent); box-shadow: 0 0 0 4px rgba(31,92,255,.12); animation: signalPulse 2s ease-in-out infinite; }
.activity-item.active { background: transparent; }
.activity-marker { color: var(--accent-strong); font: 12px ui-monospace, monospace; }
.activity-top { font-size: 10px; }
.activity-state { color: #89939f; font-size: 8px; letter-spacing: .08em; }
.activity-detail { color: #6f7884; font-size: 9px; }
.tool-catalog { display: block; }
.tool-filter { margin-bottom: 10px; border-color: #c8cdd4; border-radius: 4px; background: #f7f8f7; }
.tool-pill { display: flex; align-items: center; min-height: 31px; padding: 7px 2px; border: 0; border-bottom: 1px solid #d1d6dc; border-radius: 0; background: transparent; color: #687482; font: 10px ui-monospace, monospace; transition: transform var(--motion-fast) var(--ease-out), color var(--motion-fast) var(--ease-out), background var(--motion-fast) var(--ease-out); }
.tool-pill::before { width: 5px; height: 5px; margin-right: 8px; border-radius: 50%; background: #aab3bf; content: ""; transition: background var(--motion-fast) var(--ease-out); }
.tool-pill:hover { background: transparent; color: var(--accent-strong); transform: translateX(4px); }
.tool-pill:hover::before { background: var(--accent); }
.changes-view { background: var(--surface); }
.changes-list { padding: 25px 13px; border-right: 0; background: #161e2b; color: #dfe5ee; }
.changes-heading { padding: 0 7px 17px; }
.changes-heading::before { color: #f4f6fa; font: 700 18px var(--font-display); letter-spacing: -.04em; }
.changes-action { border-color: #354258; background: #202a3a; color: #aeb9ca; }
.changes-action.primary-action { border-color: #3869e8; background: #2349aa; color: #fff; }
.changes-group-title { color: #77859a; }
.change-file { color: #9eabba; border-radius: 4px; }
.change-file:hover, .change-file.selected { background: #222e41; color: #fff; }
.change-path { font-size: 10px; }
.stage-toggle { border-color: #526078; color: #83a4ff; }
.stage-toggle.staged { border-color: #5b85ff; background: #213d83; }
.diff-pane { background: var(--surface); }
.diff-toolbar { min-height: 61px; padding: 0 24px; background: #f6f5f1; border-bottom-color: var(--line); }
.diff-file-title { font: 12px ui-monospace, monospace; }
.diff-tab { border-radius: 3px; }
.diff-tab.active { background: var(--accent); color: #fff; }
.diff { padding-top: 23px; background: #fbfaf7; }
.diff-line.hunk { background: #e9efff; color: var(--accent-strong); }
.terminal-view { background: #e8e7e2; }
.terminal-toolbar { min-height: 61px; padding: 0 24px; background: #f6f5f1; border-bottom-color: var(--line); }
.terminal-title { font: 700 12px var(--font-ui); }
.terminal-live { background: var(--accent); box-shadow: 0 0 0 4px rgba(31,92,255,.12); }
.button { border-color: #c3c8d0; border-radius: 4px; background: #fafaf8; color: #68727e; }
.button:hover { border-color: var(--accent); background: var(--accent-wash); color: var(--accent-strong); }
.terminal-host { margin: 19px 22px 22px; border-color: #2b3950; border-radius: 8px; background: #111722; box-shadow: 0 18px 32px rgba(18,25,38,.15); }
.tool-card { border-radius: 5px; border-color: var(--line); background: #f8f7f3; }
.tool-card.running { border-left-color: var(--accent); }
@keyframes signalPulse { 0%, 100% { opacity: .75; transform: scale(1); } 50% { opacity: 1; transform: scale(1.12); } }
@media (max-width: 1140px) { .shell { grid-template-columns: 224px minmax(0, 1fr); } }
@media (max-width: 760px) {
  .main { flex: 1 1 auto; min-height: 0; }
  .sidebar { background: #111722; overflow: hidden; }
  .nav { margin: 0; align-items: center; }
  .topbar { background: #f6f5f1; }
  .conversation { padding: 28px 15px 12px; }
  .welcome { margin-top: 5vh; }
  .welcome h2 { font-size: clamp(40px, 13vw, 58px); }
  .workspace-brief { margin-top: 31px; padding-left: 15px; }
  .brief-main { grid-template-columns: 108px minmax(0, 1fr); gap: 14px; min-height: 145px; }
  .brief-orbit { width: 100px; height: 100px; }
  .brief-orbit strong { font-size: 29px; }
  .brief-orbit small { bottom: 23px; font-size: 8px; }
  .brief-copy strong { font-size: 24px; }
  .brief-footer { display: block; padding: 10px 0 0; }
  .brief-footer > span { display: block; margin-bottom: 7px; }
  .suggestions { grid-template-columns: 1fr; }
  .suggestion { min-height: 39px; border-top: 1px solid var(--line); border-left: 0; }
  .composer-wrap { padding: 8px 12px 12px; }
  .changes-list { padding: 15px 7px; }
  .changes-heading::before { font-size: 15px; }
  .diff-toolbar, .terminal-toolbar { padding: 0 13px; }
  .terminal-host { margin: 12px; }
}

/* Keep the conversation as the scroll region and the composer as its fixed flex sibling. */
.main { min-height: 0; }
.content { flex: 1 1 0; min-height: 0; }
.chat-view { height: 100%; min-height: 0; flex: 1 1 0; }
.conversation { min-height: 0; flex: 1 1 0; }
.composer-wrap { position: relative; z-index: 2; flex: 0 0 auto; background: linear-gradient(to bottom, rgba(251,250,247,0), rgba(251,250,247,.96) 22%, var(--surface) 55%); }
.composer { position: relative; }
.command-menu { position: absolute; right: 0; bottom: calc(100% + 10px); left: 0; z-index: 4; display: grid; max-height: min(360px, calc(100dvh - 180px)); overflow-y: auto; border: 1px solid var(--line-strong); border-radius: 8px; background: rgba(251,250,247,.98); box-shadow: 0 18px 42px rgba(24,32,51,.14); }
.command-menu[hidden] { display: none; }
.command-option { display: grid; grid-template-columns: minmax(92px, 150px) minmax(0, 1fr); gap: 14px; align-items: center; width: 100%; min-height: 42px; padding: 8px 12px; border: 0; border-bottom: 1px solid var(--line); background: transparent; color: var(--muted); cursor: pointer; text-align: left; }
.command-option:last-child { border-bottom: 0; }
.command-option:hover, .command-option.selected { background: var(--accent-wash); color: var(--text); }
.command-name { color: var(--accent-strong); font: 700 11px ui-monospace, monospace; }
.command-description { overflow: hidden; color: var(--muted); font: 10px/1.35 var(--font-ui); text-overflow: ellipsis; white-space: nowrap; }
@media (max-width: 760px) {
  .command-menu { bottom: calc(100% + 8px); max-height: min(320px, calc(100dvh - 155px)); }
  .command-option { grid-template-columns: minmax(82px, 110px) minmax(0, 1fr); gap: 10px; padding-inline: 10px; }
}

:root[data-theme="dark"] {
  color-scheme: dark;
  --canvas: #0b1018;
  --surface: #111722;
  --surface-soft: #172131;
  --surface-hover: #1b293d;
  --surface-blue: #162f68;
  --line: #273447;
  --line-strong: #41516a;
  --text: #edf2fb;
  --muted: #a1adbf;
  --faint: #748196;
  --accent: #5b8cff;
  --accent-strong: #a8c0ff;
  --accent-wash: #1a397a;
  --warning: #e2ad55;
  --danger: #ff8d84;
  --added: #58c98d;
  --removed: #ff8d84;
  --terminal: #090e16;
  --terminal-ink: #edf2fb;
}
:root[data-theme="dark"] body { background: var(--canvas); color: var(--text); }
:root[data-theme="dark"] .main,
:root[data-theme="dark"] .content,
:root[data-theme="dark"] .changes-view,
:root[data-theme="dark"] .diff-pane,
:root[data-theme="dark"] .terminal-view { background-color: var(--surface); }
:root[data-theme="dark"] .content { background-image: none; }
:root[data-theme="dark"] .topbar,
:root[data-theme="dark"] .composer,
:root[data-theme="dark"] .command-menu { background: rgba(17,23,34,.98); }
:root[data-theme="dark"] .composer-wrap { background: linear-gradient(to bottom, rgba(17,23,34,0), rgba(17,23,34,.96) 22%, var(--surface) 55%); }
:root[data-theme="dark"] .topbar { border-bottom-color: var(--line); }
:root[data-theme="dark"] .view-title,
:root[data-theme="dark"] .brief-copy strong,
:root[data-theme="dark"] .welcome h2,
:root[data-theme="dark"] .brief-head,
:root[data-theme="dark"] .command-option:hover,
:root[data-theme="dark"] .command-option.selected { color: var(--text); }
:root[data-theme="dark"] .welcome p,
:root[data-theme="dark"] .brief-copy p,
:root[data-theme="dark"] .brief-footer > span { color: var(--muted); }
:root[data-theme="dark"] .workspace-brief { border-color: var(--line-strong); }
:root[data-theme="dark"] .brief-orbit { border-color: var(--line-strong); background: radial-gradient(circle at 50% 48%, var(--surface) 0 31%, transparent 32%), linear-gradient(135deg, rgba(91,140,255,.16), transparent 64%); }
:root[data-theme="dark"] .brief-orbit-ring { border-color: #526582; }
:root[data-theme="dark"] .brief-orbit-node-two { background: var(--text); }
:root[data-theme="dark"] .rightbar { background: #0e151f; border-left-color: var(--line); }
:root[data-theme="dark"] .right-section,
:root[data-theme="dark"] .telemetry-panel,
:root[data-theme="dark"] .todos-panel { background: #121b29; border-bottom-color: var(--line); }
:root[data-theme="dark"] .right-section.fill { background: #101925; }
:root[data-theme="dark"] .telemetry-cell { background: #172131; }
:root[data-theme="dark"] .telemetry-cell:first-child,
:root[data-theme="dark"] .session-panel { background: #09111d; }
:root[data-theme="dark"] .activity-list { border-left-color: #3a4960; }
:root[data-theme="dark"] .activity-item::before { border-color: #101925; }
:root[data-theme="dark"] .tool-filter { background: #111a27; border-color: var(--line-strong); color: var(--text); }
:root[data-theme="dark"] .tool-pill { border-bottom-color: var(--line); color: var(--muted); }
:root[data-theme="dark"] .tool-pill:hover { background: var(--surface-hover); color: var(--accent-strong); }
:root[data-theme="dark"] .changes-list { background: #0d1521; }
:root[data-theme="dark"] .diff-toolbar,
:root[data-theme="dark"] .terminal-toolbar { background: #121b29; border-bottom-color: var(--line); }
:root[data-theme="dark"] .diff { background: var(--surface); color: var(--text); }
:root[data-theme="dark"] .terminal-host { border-color: #344663; background: var(--terminal); }
:root[data-theme="dark"] .tool-card { background: #141e2c; border-color: var(--line); }
:root[data-theme="dark"] .tool-card-args,
:root[data-theme="dark"] .tool-card-output,
:root[data-theme="dark"] .inline-diff,
:root[data-theme="dark"] .todo-checklist { background: var(--surface-soft); border-color: var(--line); color: var(--muted); }
:root[data-theme="dark"] .modal { background: var(--surface); border-color: var(--line-strong); }
:root[data-theme="dark"] .modal pre { background: var(--terminal); }
:root[data-theme="dark"] .choice,
:root[data-theme="dark"] .question-text,
:root[data-theme="dark"] .action { background: var(--surface); border-color: var(--line-strong); color: var(--muted); }
:root[data-theme="dark"] .command-option { border-bottom-color: var(--line); }
:root[data-theme="dark"] .command-description { color: var(--muted); }
:root[data-theme="dark"] .command-option:hover .command-description,
:root[data-theme="dark"] .command-option.selected .command-description { color: #c6d2e5; }
`;
