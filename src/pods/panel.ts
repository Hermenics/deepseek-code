import { POD_APPEARANCE_OPTIONS, POD_TONE_COLORS } from './types.js'
import { POD_AVATAR_RUNTIME } from './pod-avatar-runtime.js'
import { INTELLIGENT_UI_RUNTIME } from './intelligent-ui.js'
import { COMMAND_DESCRIPTIONS, COMMAND_SUGGESTIONS, parseCommand, REVIEW_PROMPT } from '../commands/index.js'

const POD_COMMANDS = ['/new', '/help', '/config', '/settings', '/clear', '/model', '/plan', '/review', '/verify', '/test', '/retry', '/sessions', '/steer'].filter(command => command === '/new' || COMMAND_SUGGESTIONS.includes(command))

/** Bundled with the CLI: embedded branding, no third-party scripts or credentials in browser storage. */
export const BOT_PANEL_HTML = String.raw`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DeepSeek Pods</title><link rel="icon" type="image/png" href="/logo.png">
<style nonce="__NONCE__">
@font-face { font-family: Geist; src: url("/geist.woff2") format("woff2"); font-weight: 100 900; font-style: normal; font-display: swap; }
/* Neutral chrome; each pod carries its own color and silhouette. */
:root {
  color-scheme: dark;
  --canvas: #202020; --surface: #181818; --raised: #2c2c2c; --soft: #252525;
  --ink: #f0f0ee; --muted: #b4b4b0; --subtle: #979793; --line: #343434; --strong: #535353;
  --accent: #c4c4c4; --green: #99c6a6; --amber: #e5bf79; --red: #e4a198;
  --green-wash: #233128; --amber-wash: #352d20; --red-wash: #362522;
  font: 14px/1.55 Geist, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  color: var(--ink); background: var(--canvas); font-synthesis: none; text-rendering: optimizeLegibility;
}
:root[data-theme="light"] {
  color-scheme: light;
  --canvas: #fafafa; --surface: #f1f1f1; --raised: #e7e7e7; --soft: #f4f4f4;
  --ink: #272727; --muted: #646464; --subtle: #707070; --line: #dedede; --strong: #c5c5c5;
  --accent: #404040; --green: #3c7650; --amber: #936219; --red: #aa4940;
  --green-wash: #edf5ef; --amber-wash: #faf3e6; --red-wash: #fbefed;
}
* { box-sizing: border-box; }
body { min-width: 320px; margin: 0; }
button, input, textarea, select { font: inherit; }
button { min-height: 36px; padding: 7px 12px; border: 1px solid var(--line); border-radius: 7px; background: transparent; color: var(--ink); cursor: pointer; transition: background .16s ease, color .16s ease, transform .12s ease; }
button:hover { background: var(--raised); }
button:active { transform: scale(.98); }
button:disabled { cursor: not-allowed; opacity: .5; }
button.primary { background: var(--ink); border-color: var(--ink); color: var(--canvas); font-weight: 600; }
button.primary:hover { opacity: .85; }
button.danger { color: var(--red); }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
input, textarea, select { width: 100%; padding: 10px 12px; border: 1px solid var(--strong); border-radius: 7px; background: var(--canvas); color: var(--ink); }
input::placeholder, textarea::placeholder { color: var(--subtle); }
input[type="checkbox"] { width: auto; margin-right: 8px; accent-color: var(--accent); }
textarea { min-height: 82px; resize: vertical; }
label { display: block; margin-bottom: 12px; color: var(--muted); font-size: 13px; font-weight: 500; }
label input, label textarea, label select { margin-top: 6px; font-weight: 400; }
h1, h2, h3, p { margin: 0; }
h1 { font-size: 20px; font-weight: 600; letter-spacing: -.04em; line-height: 1.3; }
h2 { font-size: 15px; font-weight: 600; letter-spacing: -.02em; }
h3 { font-size: 14px; }
p { line-height: 1.65; }
a { color: var(--ink); text-underline-offset: 3px; }
.muted { color: var(--muted); font-size: 12px; }
.eyebrow { color: var(--subtle); font-size: 11px; font-weight: 500; }
.row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.spread { justify-content: space-between; }
.stack { display: grid; gap: 12px; }
.actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 14px; }
pre { max-height: 330px; overflow: auto; padding: 12px; border-radius: 10px; background: var(--surface); color: var(--muted); white-space: pre-wrap; overflow-wrap: anywhere; font: 12px/1.65 ui-monospace, Consolas, monospace; }
summary { color: var(--muted); cursor: pointer; }
summary:hover { color: var(--ink); }
details { margin-top: 12px; }
time { color: var(--subtle); font-size: 11px; font-variant-numeric: tabular-nums; }
[hidden] { display: none !important; }
#notice { position: fixed; inset: auto 20px 20px; z-index: 6; max-width: 600px; margin: auto; padding: 12px 18px; border: 1px solid var(--strong); border-radius: 14px; background: var(--surface); color: var(--ink); box-shadow: 0 8px 32px #0003; }
#login { min-height: 100dvh; display: grid; place-items: center; padding: 28px 18px; }
.login-card { width: min(100%, 440px); padding: 36px; }
.brand { display: inline-flex; align-items: center; gap: 9px; color: var(--ink); font-size: 15px; font-weight: 600; letter-spacing: -.03em; white-space: nowrap; }
.brand b { font-weight: 600; }
.brand-mark { width: 32px; height: 28px; object-fit: contain; }
.login-card .eyebrow { margin-top: 38px; }
.login-card h1 { margin-top: 9px; font-size: 26px; letter-spacing: -.03em; }
.login-copy { margin-top: 12px; color: var(--muted); }
.login-token-help { margin: 10px 0 16px; color: var(--muted); font-size: 12px; }
.login-token-help summary { cursor: pointer; }
.login-token-help p { margin: 8px 0 0; }
#login form { margin-top: 28px; }
#login form > button[type="submit"] { width: 100%; }
.login-token-label { margin-bottom: 0; }
.login-token-field { position: relative; margin: 6px 0 12px; }
.login-token-field input { min-height: 44px; margin: 0; padding-right: 68px; }
.login-token-field button { position: absolute; top: 1px; right: 1px; min-width: 56px; min-height: 42px; padding: 4px 9px; border: 0; color: var(--muted); font-size: 12px; }
.error { margin-top: 10px; color: var(--red); }
#app { height: 100dvh; display: grid; grid-template-rows: 58px minmax(0, 1fr); }
.top { min-width: 0; padding: 0 20px; border-bottom: 1px solid var(--line); background: var(--surface); }
.top .row { flex-wrap: nowrap; }
.top-actions { gap: 8px; }
.top-actions button { font-size: 12px; border-color: transparent; }
.connection { color: var(--muted); font-size: 11px; white-space: nowrap; }
.connection::before { display: inline-block; width: 6px; height: 6px; margin-right: 7px; border-radius: 50%; background: var(--green); content: ""; }
.connection[data-state="offline"]::before { background: var(--red); }
.review-count { padding: 0 5px; border-radius: 5px; background: var(--amber-wash); color: var(--amber); font-size: 11px; }
.layout { min-width: 0; min-height: 0; display: grid; grid-template-columns: 252px minmax(0, 1fr); }
.layout.with-review-panel { grid-template-columns: 252px minmax(0, 1fr) 340px; }
.layout.with-computer { padding-right: min(44vw, 640px); }
.rail { min-width: 0; min-height: 0; overflow: hidden; display: flex; flex-direction: column; padding: 18px 12px; background: var(--surface); border-right: 1px solid var(--line); }
#rail-content { flex: 1; min-width: 0; min-height: 0; overflow: auto; display: flex; flex-direction: column; }
#mobile-tabs { display: none; }
.workspace-picker { position: relative; display: flex; flex-direction: column; width: auto; height: 100%; min-width: 0; overflow: hidden; background: var(--surface); }
#workspace-picker { display: none; }
@media (min-width: 1181px) and (hover: hover) and (pointer: fine) { #workspace-picker { display: flex; } }
.workspace-picker .rail { flex: 1; width: 100%; min-height: 0; }
#quick-open-trigger { display: flex; align-items: center; gap: 14px; min-height: 34px; padding: 5px 8px 5px 12px; color: var(--muted); border-color: var(--line); font-size: 12px; }
#quick-open-trigger kbd { padding: 1px 5px; border: 1px solid var(--line); border-radius: 4px; color: var(--subtle); font: inherit; font-size: 10px; line-height: 1.5; }
.rail-search { margin: 2px 4px 24px; font-weight: 400; }
.rail-search input { padding: 9px 11px; background: transparent; border-color: var(--line); font-size: 12px; }
.rail-heading { display: flex; align-items: center; justify-content: space-between; margin: 0 12px 10px; gap: 8px; }
.rail-heading h2 { color: var(--muted); font-size: 12px; font-weight: 500; }
.rail-count { color: var(--subtle); font-size: 11px; }
.groups-heading { margin-top: 30px; }
#bots { display: grid; grid-template-columns: minmax(0, 1fr); gap: 4px; }
.bot { min-width: 0; display: flex; align-items: center; gap: 10px; width: 100%; min-height: 64px; padding: 8px 10px; border: 0; border-radius: 6px; text-align: left; }
.bot.selected { background: var(--raised); }
.bot-details { flex: 1; min-width: 0; }
.bot strong { display: block; overflow: hidden; font-size: 14px; font-weight: 550; text-overflow: ellipsis; white-space: nowrap; }
.bot-meta { display: flex; min-width: 0; gap: 6px; margin-top: 3px; }
.bot-preview { display: block; min-width: 0; overflow: hidden; color: var(--muted); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.bot .agent-status { display: none; }
.bot[data-state="waiting"] .agent-status, .bot[data-state="blocked"] .agent-status { display: block; color: var(--amber); font-size: 10px; }
.new { width: 100%; margin-top: 9px; border: 0; color: var(--muted); font-size: 12px; text-align: left; }
.new::before { margin-right: 10px; content: "+"; font-size: 18px; vertical-align: -1px; }
.conversation-heading { margin-top: 28px; }
.conversation-heading .new-conversation { width: 30px; min-width: 30px; min-height: 30px; padding: 0; border-radius: 7px; font-size: 18px; }
#conversations { display: grid; gap: 3px; }
.conversation-row { display: flex; align-items: stretch; gap: 2px; min-width: 0; }
.conversation-item { display: block; flex: 1; width: 100%; min-width: 0; padding: 9px 10px; border: 0; border-radius: 7px; text-align: left; }
.conversation-item[aria-current="true"] { background: var(--raised); }
.conversation-item:disabled { color: var(--muted); opacity: .75; }
.conversation-delete { width: 30px; min-width: 30px; padding: 0; border: 0; color: var(--red); opacity: .8; }
.conversation-item strong { display: flex; align-items: center; gap: 6px; min-width: 0; overflow: hidden; font-size: 12px; font-weight: 550; }
.conversation-title-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.conversation-draft { flex: 0 0 auto; padding: 1px 5px; border-radius: 4px; background: var(--green-wash); color: var(--green); font-size: 9px; font-weight: 600; line-height: 1.4; }
.conversation-item time { display: block; margin-top: 3px; font-size: 10px; }
#mobile-conversation-trigger, #mobile-new-conversation { display: none; }
#mobile-conversation-trigger { flex: 1 1 0; align-items: center; justify-content: space-between; gap: 8px; min-width: 0; min-height: 44px; padding: 5px 9px; border-color: var(--line); color: var(--ink); text-align: left; }
.mobile-conversation-current { display: grid; min-width: 0; gap: 2px; }
.mobile-conversation-kind { color: var(--subtle); font-size: 9px; letter-spacing: .08em; text-transform: uppercase; }
#mobile-conversation-title { overflow: hidden; font-size: 12px; font-weight: 550; text-overflow: ellipsis; white-space: nowrap; }
.mobile-conversation-count { display: grid; place-items: center; min-width: 20px; height: 20px; padding: 0 5px; border-radius: 10px; background: var(--raised); color: var(--muted); font-size: 10px; font-variant-numeric: tabular-nums; }
.mobile-conversation-chevron { width: 7px; height: 7px; margin: -4px 2px 0 0; border-right: 1.5px solid currentColor; border-bottom: 1.5px solid currentColor; transform: rotate(45deg); }
#mobile-new-conversation { width: 44px; min-width: 44px; min-height: 44px; padding: 0; border-color: var(--line); color: var(--ink); font-size: 20px; }
#group-list .bot { min-height: 36px; color: var(--muted); font-size: 12px; }
.bot-avatar { width: 48px; height: 48px; }
.workspace { min-width: 0; min-height: 0; display: flex; flex-direction: column; background: var(--canvas); }
.mobile-pods-page { display: none; flex: 1; min-height: 0; flex-direction: column; overflow: hidden; }
.mobile-pods-head { flex: 0 0 auto; padding: 26px max(clamp(18px, 4vw, 36px), calc((100vw - 1180px) / 2)) 18px; border-bottom: 1px solid var(--line); }
.mobile-pods-head .eyebrow { margin-bottom: 8px; color: var(--green); font-size: 10px; letter-spacing: .14em; }
.mobile-pods-head h1 { font-size: clamp(26px, 5vw, 34px); }
.mobile-pods-intro { margin-top: 6px; color: var(--muted); font-size: 13px; }
.mobile-workspace-switch { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px; margin-top: 12px; padding: 3px; border: 1px solid var(--line); border-radius: 10px; background: var(--surface); }
.mobile-workspace-switch button { min-height: 38px; padding: 5px 8px; border: 0; color: var(--muted); font-size: 12px; }
.mobile-workspace-switch button[aria-pressed="true"] { background: var(--raised); color: var(--ink); font-weight: 600; }
.mobile-workspace-switch-count { margin-left: 6px; color: var(--subtle); font-size: 10px; font-variant-numeric: tabular-nums; }
.mobile-pods-tools { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: end; gap: 8px; margin-top: 10px; }
.mobile-pods-tools input, .mobile-pods-tools button { min-height: 44px; }
.mobile-pods-tools label { margin: 0; }
.mobile-pods-filters { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; margin-top: 8px; }
.mobile-pods-filters[data-view="groups"] { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.mobile-pods-filters[data-view="groups"] [data-pods-filter="paused"] { display: none; }
.mobile-pods-filters button { display: grid; align-content: center; justify-items: center; gap: 2px; min-width: 0; min-height: 46px; padding: 5px 2px; border-color: var(--line); background: var(--surface); color: var(--muted); font-size: 10px; white-space: nowrap; }
.mobile-pods-filters button[aria-pressed="true"] { border-color: var(--strong); background: var(--raised); color: var(--ink); font-weight: 600; }
.mobile-pods-filter-count { color: var(--subtle); font-size: 10px; font-variant-numeric: tabular-nums; }
.mobile-pods-filters button[aria-pressed="true"] .mobile-pods-filter-count { color: var(--green); }
.mobile-pods-count { margin-top: 10px; font-size: 11px; }
.mobile-pods-list { flex: 1; min-height: 0; display: grid; align-content: start; gap: 8px; overflow: auto; margin: 0; padding: 14px max(clamp(18px, 4vw, 36px), calc((100vw - 1180px) / 2)) max(20px, env(safe-area-inset-bottom)); list-style: none; overscroll-behavior: contain; }
.mobile-pod-card { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 8px; width: 100%; min-height: 76px; padding: 8px 10px; border-color: var(--line); border-radius: 11px; background: var(--surface); }
.mobile-pod-card[data-selected="true"] { border-color: var(--strong); background: var(--raised); }
.mobile-pod-main { display: grid; grid-template-columns: 44px minmax(0, 1fr) auto; align-items: center; gap: 10px; min-width: 0; min-height: 58px; padding: 0 2px; border: 0; background: transparent; color: var(--ink); text-align: left; }
.mobile-pod-task { display: grid; grid-auto-flow: column; align-items: center; justify-content: center; gap: 5px; min-width: 44px; min-height: 44px; padding: 6px 10px; border-color: var(--line); color: var(--green); font-size: 11px; white-space: nowrap; }
.mobile-pod-task-icon { font-size: 18px; line-height: 1; }
.mobile-pod-avatar { width: 44px; height: 44px; }
.mobile-pod-copy { display: grid; min-width: 0; gap: 4px; }
.mobile-pod-copy strong { overflow: hidden; font-size: 13px; font-weight: 550; text-overflow: ellipsis; white-space: nowrap; }
.mobile-pod-copy > span { overflow: hidden; color: var(--muted); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.mobile-pod-copy > .mobile-pod-project { color: var(--subtle); font-size: 10px; }
.mobile-pod-meta { display: grid; justify-items: end; gap: 4px; }
.mobile-pod-state { color: var(--muted); font-size: 10px; white-space: nowrap; }
.mobile-pod-state[data-state="running"], .mobile-pod-state[data-state="ready"], .mobile-pod-state[data-state="completed"] { color: var(--green); }
.mobile-pod-state[data-state="waiting"], .mobile-pod-state[data-state="blocked"], .mobile-pod-state[data-state="queued"], .mobile-pod-state[data-state="reconcile"] { color: var(--amber); }
.mobile-pod-state[data-state="failed"] { color: var(--red); }
.mobile-pod-open { color: var(--subtle); font-size: 10px; }
.mobile-pod-open[data-draft="true"] { color: var(--green); font-weight: 600; }
.mobile-group-card { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 6px; width: 100%; min-height: 72px; padding: 6px 8px; border: 1px solid var(--line); border-radius: 11px; background: var(--surface); }
.mobile-group-card:focus-within { border-color: var(--strong); }
.mobile-group-open { display: grid; grid-template-columns: 40px minmax(0, 1fr) auto; align-items: center; gap: 10px; width: 100%; min-width: 0; min-height: 56px; padding: 4px 2px; border: 0; background: transparent; color: var(--ink); text-align: left; }
.mobile-group-open:hover { background: var(--raised); }
.mobile-group-avatars { display: flex; align-items: center; padding-left: 2px; }
.mobile-group-avatars .reply-avatar { width: 30px; height: 30px; margin-left: -5px; border: 2px solid var(--surface); }
.mobile-group-copy { display: grid; min-width: 0; gap: 4px; }
.mobile-group-copy strong, .mobile-group-copy span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mobile-group-copy strong { font-size: 13px; font-weight: 550; }
.mobile-group-copy .mobile-group-task-preview { color: var(--ink); font-weight: 500; }
.mobile-group-copy span, .mobile-group-meta { color: var(--muted); font-size: 10px; }
.mobile-group-meta { display: grid; justify-items: end; gap: 4px; white-space: nowrap; }
.mobile-group-meta span { color: var(--subtle); }
.mobile-group-meta .mobile-group-draft { padding: 2px 5px; border-radius: 5px; background: var(--green-wash); color: var(--green); font-size: 9px; }
.mobile-group-meta .mobile-group-paused, .mobile-group-meta .mobile-group-attention { color: var(--amber); }
.mobile-group-copy .mobile-group-task-preview[data-state="waiting"], .mobile-group-copy .mobile-group-task-preview[data-state="blocked"] { color: var(--amber); font-weight: 600; }
.mobile-group-meta .mobile-group-activity { color: var(--green); }
@media (max-width: 360px) { .mobile-pod-task { width: 44px; padding: 0; } .mobile-pod-task-label { display: none; } .mobile-group-open { gap: 7px; } }
.mobile-pods-empty { display: grid; justify-items: start; gap: 10px; margin: auto; padding: 30px 8px; }
.mobile-pods-empty .eyebrow { color: var(--green); font-size: 10px; letter-spacing: .14em; }
.mobile-pods-empty h2 { font-size: 20px; }
.mobile-pods-empty p { max-width: 36ch; color: var(--muted); font-size: 13px; }
.workspace[data-pods-page="true"] .heading, .workspace[data-pods-page="true"] .feed-heading, .workspace[data-pods-page="true"] #feed, .workspace[data-pods-page="true"] #composer { display: none !important; }
.workspace[data-pods-page="true"] #mobile-pods-page { display: flex; }
.heading { padding: 20px 28px 16px; }
.heading-top { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.agent-title { min-width: 0; display: flex; align-items: center; gap: 12px; }
.agent-title > div { min-width: 0; }
#bot-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.heading .eyebrow { display: none; }
.agent-actions { display: flex; align-items: center; gap: 10px; }
.agent-actions button { min-height: 36px; padding: 6px 10px; font-size: 12px; border: 1px solid transparent; color: var(--muted); }
.agent-actions #new-conversation-main { border-color: var(--line); color: var(--ink); }
.agent-actions #pod-settings { min-width: 36px; }
.agent-more { position: relative; }
.agent-more > summary { display: flex; min-height: 36px; align-items: center; gap: 8px; padding: 6px 10px; border: 1px solid var(--line); border-radius: 7px; color: var(--muted); cursor: pointer; font-size: 12px; list-style: none; }
.agent-more > summary::-webkit-details-marker { display: none; }
.agent-more > summary::after { width: 6px; height: 6px; border-right: 1px solid currentColor; border-bottom: 1px solid currentColor; content: ""; transform: rotate(45deg) translateY(-2px); }
.agent-more[open] > summary::after { transform: rotate(225deg) translate(-1px, -1px); }
.agent-more-actions { position: absolute; z-index: 7; top: calc(100% + 8px); right: 0; display: flex; width: max-content; min-width: 190px; flex-direction: column; align-items: stretch; gap: 4px; padding: 6px; border: 1px solid var(--line); border-radius: 10px; background: var(--surface); box-shadow: 0 14px 32px #0005; }
.agent-more:not([open]) > .agent-more-actions { display: none; }
.agent-more-actions > button { width: 100%; justify-content: flex-start; padding: 8px 10px; text-align: left; }
.agent-state { color: var(--muted); font-size: 11px; text-transform: capitalize; white-space: nowrap; }
.agent-state[data-state="running"] { color: var(--green); }
.agent-state[data-state="waiting"], .agent-state[data-state="blocked"] { color: var(--amber); }
.heading > p { max-width: 80ch; margin: 4px 0 0 72px; color: var(--muted); font-size: 13px; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.project-context { display: flex; align-items: center; gap: 8px; min-width: 0; margin: 6px 0 0 72px; }
.project-context-label { flex: 0 0 auto; color: var(--subtle); font-size: 11px; }
.project-context code { min-width: 0; overflow: hidden; color: var(--muted); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.project-context button { flex: 0 0 auto; min-width: 44px; min-height: 32px; padding: 4px 8px; color: var(--muted); font-size: 10px; }
.browser-control { margin: 0; font-size: 11px; color: var(--muted); border-color: transparent; padding: 4px 0; min-height: 28px; }
.browser-control::before { display: inline-block; width: 13px; height: 10px; margin-right: 8px; border: 1.5px solid currentColor; border-radius: 2px; content: ""; vertical-align: -1px; }
.feed-heading { padding: 0 30px; border-bottom: 1px solid var(--line); }
.workspace-tabs { display: flex; gap: 20px; }
.workspace-tabs button { min-height: 44px; padding: 6px 0; border: 0; border-radius: 0; color: var(--muted); font-size: 13px; }
.workspace-tabs button[aria-pressed="true"] { color: var(--ink); box-shadow: inset 0 -2px var(--ink); }
.mobile-workspace-view { display: none; }
#feed { flex: 1; min-height: 0; overflow: auto; padding: 16px 36px 30px; }
.turn { width: min(800px, 100%); margin: 12px auto 28px; overflow-wrap: anywhere; }
.turn > .row.spread { justify-content: flex-end; gap: 10px; }
.badge { display: inline-flex; align-items: center; gap: 5px; color: var(--muted); font-size: 10px; text-transform: capitalize; }
.badge.running, .badge.completed { color: var(--green); }
.badge.waiting, .badge.blocked { color: var(--amber); }
.badge.failed { color: var(--red); }
.prompt { width: fit-content; max-width: 85%; margin: 8px 0 20px auto; padding: 12px 16px; border-radius: 12px 12px 3px 12px; background: var(--raised); font-size: 15px; white-space: pre-wrap; }
.turn > details.prompt-details { width: fit-content; max-width: 85%; margin: 8px 0 20px auto; font-size: 15px; }
.prompt-details > summary { display: flex; align-items: center; gap: 12px; min-height: 44px; padding: 12px 16px; border-radius: 12px 12px 3px 12px; background: var(--raised); cursor: pointer; list-style: none; }
.prompt-details > summary::-webkit-details-marker { display: none; }
.prompt-preview { display: -webkit-box; min-width: 0; overflow: hidden; color: var(--ink); font-size: 15px; line-height: 1.45; overflow-wrap: anywhere; -webkit-box-orient: vertical; -webkit-line-clamp: 3; }
.prompt-expand { flex: 0 0 auto; color: var(--muted); font-size: 11px; white-space: nowrap; }
.prompt-details[open] > summary { border-radius: 12px 12px 0 0; }
.prompt-full { width: auto; max-width: none; max-height: 45dvh; overflow: auto; margin: 0 !important; border-radius: 0 0 3px 12px; }
.agent-reply { display: flex; gap: 13px; align-items: flex-start; margin-top: 18px; }
.reply-content { min-width: 0; padding-top: 3px; }
.reply-result-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
.reply-result-actions .result-link { min-height: 34px; margin: 0; padding: 5px 10px; font-size: 12px; }
.reply-name { display: block; margin-bottom: 7px; font-size: 12px; font-weight: 600; }
.answer { color: var(--ink); font-size: 15px; line-height: 1.75; white-space: pre-wrap; overflow-wrap: anywhere; }
.answer-copy { white-space: pre-wrap; overflow-wrap: anywhere; }
.answer-code { margin: 14px 0; overflow: hidden; border: 1px solid var(--line); border-radius: 10px; background: var(--surface); }
.answer-code-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 6px 10px; border-bottom: 1px solid var(--line); }
.answer-code-language { min-width: 0; overflow: hidden; color: var(--muted); font: 11px ui-monospace, Consolas, monospace; text-overflow: ellipsis; white-space: nowrap; }
.answer-code-header button { min-height: 30px; padding: 4px 9px; font-size: 11px; }
.answer-code pre.answer-code-content { max-height: 420px; margin: 0; padding: 12px; overflow: auto; border-radius: 0; background: transparent; color: var(--ink); white-space: pre; overflow-wrap: normal; }
.answer-code pre.answer-code-content code { font: inherit; }
.intelligent-ui { margin-top: 14px; overflow: hidden; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); white-space: normal; }
.intelligent-ui-title { padding: 14px 16px 0; }
.intelligent-ui-body, .ui-stack { display: grid; gap: 12px; padding: 14px 16px 16px; }
.ui-stack { padding: 0; }
.ui-card { min-width: 0; padding: 13px; border: 1px solid var(--line); border-radius: 9px; background: var(--canvas); }
.ui-card-title, .ui-heading { margin-bottom: 8px; }
.ui-text { color: var(--muted); }
.ui-metric { display: grid; gap: 2px; min-width: 0; padding: 12px 14px; border-radius: 9px; background: var(--soft); }
.ui-metric-label, .ui-metric-detail { color: var(--muted); font-size: 12px; }
.ui-metric-value { font-size: 21px; font-variant-numeric: tabular-nums; line-height: 1.3; overflow-wrap: anywhere; }
.ui-table-wrap { max-width: 100%; overflow-x: auto; }
.ui-table-wrap table { width: 100%; border-collapse: collapse; font-size: 13px; }
.ui-table-wrap caption { padding-bottom: 5px; color: var(--subtle); text-align: left; font-size: 11px; }
.ui-table-wrap th, .ui-table-wrap td { padding: 8px 10px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; }
.ui-table-wrap th { color: var(--muted); font-weight: 600; }
.ui-chart { min-width: 0; margin: 0; }
.ui-chart-list { display: grid; gap: 8px; }
.ui-chart-row { display: grid; grid-template-columns: minmax(70px, 1fr) minmax(80px, 2fr) auto; align-items: center; gap: 10px; }
.ui-chart-label { min-width: 0; overflow-wrap: anywhere; font-size: 12px; }
.ui-chart-row progress { width: 100%; height: 9px; accent-color: var(--ink); }
.ui-chart-value { min-width: 4ch; color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; text-align: right; }
.ui-callout { padding: 10px 12px; border-radius: 8px; background: var(--soft); font-size: 13px; }
.ui-callout[data-tone="success"] { background: var(--green-wash); }
.ui-callout[data-tone="warning"] { background: var(--amber-wash); }
.ui-field { margin: 0; color: var(--muted); font-size: 12px; }
.ui-field input, .ui-field select { margin-top: 5px; }
.ui-slider-row { display: flex; align-items: center; gap: 12px; }
.ui-slider-row input { flex: 1; min-width: 0; }
.ui-slider-row output { min-width: 5ch; color: var(--ink); font-variant-numeric: tabular-nums; text-align: right; }
.ui-checkbox { display: flex; align-items: center; gap: 8px; margin: 0; cursor: pointer; }
.ui-checkbox input { width: auto; margin: 0; }
.ui-action { justify-self: start; }
.ui-link { width: fit-content; font-size: 13px; }
.answer.streaming .answer-copy:last-child::after { content: "▍"; color: var(--subtle); animation: breathe 1.2s ease-in-out infinite; }
.ui-streaming { display: flex; align-items: center; gap: 8px; min-height: 20px; color: var(--muted); font-size: 12px; }
.ui-streaming-hint::before { display: inline-block; width: 6px; height: 6px; margin-right: 8px; border-radius: 50%; background: var(--green); content: ""; animation: breathe 1.6s ease-in-out infinite; }
.turn .live-activity { min-width: 0; max-width: 100%; margin: 0 0 14px 44px; border: 1px solid var(--line); border-radius: 9px; background: var(--surface); font-size: 12px; overflow: hidden; }
.live-activity summary { padding: 8px 12px; color: var(--muted); cursor: pointer; }
.live-activity summary:hover { color: var(--ink); }
.live-activity summary .live-step-state { font-weight: 600; }
.live-activity [data-live] summary, .live-activity[data-live="true"] summary { color: var(--green); }
.live-steps { max-height: 300px; overflow-y: auto; border-top: 1px solid var(--line); }
div.step { display: grid; grid-template-columns: max-content minmax(0, 1fr); align-items: baseline; gap: 10px; min-width: 0; padding: 6px 12px; border-bottom: 1px solid var(--line); }
details.step { display: block; border-bottom: 1px solid var(--line); }
details.step:last-child, div.step:last-child { border-bottom: 0; }
details.step summary { display: grid; grid-template-columns: max-content minmax(0, 1fr); align-items: baseline; gap: 10px; min-width: 0; padding: 6px 12px; cursor: pointer; }
.step-name { min-width: 0; overflow: hidden; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.step-args { display: block; min-width: 0; overflow: hidden; color: var(--muted); text-overflow: ellipsis; white-space: nowrap; }
details.step[open] summary .step-args { color: var(--subtle); }
.step-output { display: block; max-height: 200px; margin: 0 12px 8px; padding: 8px 10px; overflow-y: auto; border-radius: 6px; background: var(--canvas); color: var(--muted); font-size: 11px; overflow-wrap: anywhere; white-space: pre-wrap; }
.run-state-line { display: flex; align-items: center; gap: 10px; margin: 0 0 14px 44px; color: var(--muted); font-size: 12px; }
.run-state-line.waiting { padding: 10px 12px; border: 1px solid var(--line); border-radius: 9px; background: var(--amber-wash); color: var(--amber); }
.run-pulse { width: 6px; height: 6px; border-radius: 50%; background: var(--subtle); }
.run-state-line.running .run-pulse { background: var(--green); animation: breathe 2s ease-in-out infinite; }
.run-state-line.waiting, .run-state-line.blocked { color: var(--amber); }
.run-state-line.failed { color: var(--red); }
.guidance-message { display: grid; justify-items: end; }
.guidance-message .muted { margin-top: -15px; font-size: 10px; }
.turn .actions, .turn > details { margin: 14px 0 0 44px; }
.turn .actions button { padding: 5px 10px; min-height: 34px; font-size: 12px; }
.turn details { font-size: 12px; }
.empty-state { width: min(800px, 100%); margin: 40px auto; display: grid; grid-template-columns: minmax(0, 1fr) 200px; gap: 12px 40px; align-items: center; text-align: left; }
.empty-state .hero-avatar { grid-column: 2; grid-row: 1 / 4; width: 200px; height: 200px; }
.empty-state h2 { font-size: 24px; font-weight: 550; letter-spacing: -.035em; }
.empty-state p { max-width: 46ch; color: var(--muted); font-size: 14px; }
.empty-state .eyebrow { display: none; }
.empty-state .actions { grid-column: 1; justify-content: flex-start; margin-top: 8px; }
#app[data-onboarding="true"] { height: 100dvh; min-height: 100dvh; grid-template-rows: 58px minmax(0, 1fr); }
#app-layout[data-onboarding="true"] { grid-template-columns: minmax(0, 1fr); }
#app-layout[data-onboarding="true"] #workspace-picker { display: none; }
#app-layout[data-onboarding="true"] .rail { display: none; }
#app-layout[data-onboarding="true"] .heading, #app-layout[data-onboarding="true"] .feed-heading, #app-layout[data-onboarding="true"] #composer { display: none; }
#app-layout[data-onboarding="true"] .workspace { min-height: 0; }
#app-layout[data-onboarding="true"] #feed { display: grid; place-items: center; padding: clamp(24px, 5vw, 72px); }
#app-layout[data-onboarding="true"] .empty-state { width: min(1020px, 100%); margin: 0; grid-template-columns: minmax(0, 1.1fr) minmax(240px, .9fr); gap: 14px 64px; }
#app-layout[data-onboarding="true"] .empty-state .eyebrow { display: block; grid-column: 1; color: var(--green); font-size: 10px; letter-spacing: .14em; }
#app-layout[data-onboarding="true"] .empty-state h2 { grid-column: 1; max-width: 13ch; font-size: clamp(36px, 4.6vw, 54px); line-height: 1.08; }
#app-layout[data-onboarding="true"] .empty-state > p:not(.eyebrow) { grid-column: 1; max-width: 48ch; font-size: 15px; }
#app-layout[data-onboarding="true"] .empty-state .hero-avatar { grid-column: 2; grid-row: 1 / 6; justify-self: center; width: clamp(220px, 28vw, 340px); height: clamp(220px, 28vw, 340px); }
.onboarding-steps { grid-column: 1; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin: 4px 0 0; padding: 0; list-style: none; }
.onboarding-step { display: grid; align-content: center; gap: 5px; min-height: 62px; padding: 10px 12px; border: 1px solid var(--line); border-radius: 9px; background: var(--surface); }
.onboarding-step-number { color: var(--green); font-size: 10px; letter-spacing: .1em; }
.onboarding-step-label { color: var(--muted); font-size: 11px; line-height: 1.35; }
#app-layout[data-onboarding="true"] .empty-state .actions { grid-column: 1; margin: 8px 0 0; }
#app-layout[data-onboarding="true"] .empty-state .actions button { min-height: 44px; padding-inline: 18px; }
.overview-link { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 40px; margin: 0 0 16px; padding: 7px 10px; border-color: transparent; color: var(--muted); text-align: left; }
.overview-link[aria-current="page"] { background: var(--raised); color: var(--ink); }
.overview-mark { display: grid; place-items: center; width: 22px; height: 22px; border-radius: 6px; background: var(--green-wash); color: var(--green); font-size: 15px; }
.overview-link .rail-count { margin-left: auto; }
.workspace[data-overview="true"] .heading, .workspace[data-overview="true"] .feed-heading, .workspace[data-overview="true"] #composer { display: none !important; }
.workspace[data-overview="true"] #feed { padding: 0; }
.overview-shell { width: min(1180px, 100%); margin: 0 auto; padding: 32px clamp(18px, 4vw, 56px) 48px; }
.overview-intro { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; padding-bottom: 24px; border-bottom: 1px solid var(--line); }
.overview-intro .eyebrow { margin-bottom: 8px; color: var(--green); font-size: 10px; letter-spacing: .14em; }
.overview-intro h1 { font-size: clamp(28px, 3.5vw, 38px); font-weight: 550; letter-spacing: -.045em; }
.overview-intro p:not(.eyebrow) { margin-top: 8px; color: var(--muted); font-size: 13px; }
.overview-intro .actions { flex: 0 0 auto; margin: 0; }
.overview-metrics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); margin: 0 0 24px; border-bottom: 1px solid var(--line); }
.overview-metric { display: grid; gap: 3px; min-width: 0; padding: 18px 18px 20px 0; border: 0; border-radius: 0; background: transparent; color: var(--ink); text-align: left; }
.overview-metric:hover { background: var(--raised); }
.overview-metric[aria-pressed="true"] { box-shadow: inset 0 -2px var(--green); }
.overview-metric + .overview-metric { padding-left: 20px; border-left: 1px solid var(--line); }
.overview-metric strong { font-size: 25px; font-weight: 500; font-variant-numeric: tabular-nums; line-height: 1.2; }
.overview-metric span { color: var(--muted); font-size: 11px; }
.overview-drafts { margin-bottom: 20px; border-color: var(--green-wash); }
.overview-drafts-list { display: grid; }
.overview-draft-item { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 12px; width: 100%; min-height: 68px; padding: 12px 18px; border: 0; border-top: 1px solid var(--line); border-radius: 0; text-align: left; }
.overview-draft-item:hover { background: var(--raised); }
.overview-draft-copy { display: grid; min-width: 0; gap: 4px; }
.overview-draft-copy strong { overflow: hidden; font-size: 12px; font-weight: 550; text-overflow: ellipsis; white-space: nowrap; }
.overview-draft-copy span { display: -webkit-box; overflow: hidden; color: var(--muted); font-size: 11px; line-height: 1.4; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.overview-draft-action { color: var(--green); font-size: 11px; font-weight: 600; white-space: nowrap; }
.overview-panels { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(250px, .8fr); align-items: start; gap: 18px; }
.overview-active-work { grid-column: 1 / -1; }
.overview-active-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr)); gap: 8px; padding: 8px; }
.overview-panel { min-width: 0; overflow: hidden; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); }
.overview-panel-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 16px 18px 12px; }
.overview-panel-header h2 { font-size: 13px; font-weight: 550; }
.overview-panel-header span { color: var(--subtle); font-size: 11px; }
.overview-pod-list { display: grid; }
.overview-pod { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 10px; width: 100%; border-top: 1px solid var(--line); }
.overview-pod-open { display: grid; grid-template-columns: 52px minmax(0, 1fr); align-items: center; gap: 13px; min-width: 0; min-height: 82px; padding: 11px 0 11px 16px; border: 0; border-radius: 0; background: transparent; color: var(--ink); text-align: left; }
.overview-pod-open:hover { background: var(--raised); }
.overview-pod-new-task { min-height: 40px; margin-right: 16px; padding-inline: 11px; font-size: 11px; }
.overview-avatar { width: 52px; height: 52px; }
.overview-pod-copy { display: grid; min-width: 0; gap: 3px; }
.overview-pod-copy strong, .overview-pod-copy > .overview-pod-project, .overview-pod-copy > .overview-pod-description { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.overview-pod-copy strong { font-size: 13px; font-weight: 550; }
.overview-pod-project { color: var(--subtle); font-size: 10px; }
.overview-pod-description { color: var(--muted); font-size: 10px; }
.overview-pod-meta { display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: 10px; }
.overview-status { color: var(--muted); font-size: 10px; text-transform: capitalize; white-space: nowrap; }
.overview-status[data-state="running"], .overview-status[data-state="completed"], .overview-status[data-state="ready"] { color: var(--green); }
.overview-status[data-state="waiting"], .overview-status[data-state="blocked"], .overview-status[data-state="queued"], .overview-status[data-state="reconcile"] { color: var(--amber); }
.overview-status[data-state="failed"] { color: var(--red); }
.overview-attention { min-height: 170px; }
.overview-attention-item { display: grid; grid-template-columns: 36px minmax(0, 1fr) auto; align-items: center; gap: 10px; width: 100%; min-height: 70px; padding: 10px 16px; border: 0; border-top: 1px solid var(--line); border-radius: 0; text-align: left; }
.overview-attention-item:hover { background: var(--raised); }
.overview-attention-avatar { width: 36px; height: 36px; }
.overview-attention-copy { display: grid; min-width: 0; gap: 3px; }
.overview-attention-copy strong { font-size: 11px; font-weight: 550; }
.overview-attention-copy span { overflow: hidden; color: var(--muted); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.overview-attention-action { display: inline-flex; align-items: center; gap: 7px; min-height: 32px; padding: 5px 9px; border: 1px solid var(--line); border-radius: 6px; color: var(--ink); font-size: 10px; font-weight: 550; white-space: nowrap; }
.overview-clear { display: grid; align-content: center; min-height: 112px; padding: 8px 18px 22px; }
.overview-clear strong { color: var(--green); font-size: 12px; font-weight: 550; }
.overview-clear span { margin-top: 4px; color: var(--muted); font-size: 11px; }
.overview-clear .primary { justify-self: start; margin-top: 12px; }
.overview-recent { margin-top: 18px; }
.overview-recent-header button { min-height: 32px; padding: 4px 9px; font-size: 11px; }
.overview-recent-list { display: grid; }
.overview-first-task { display: flex; align-items: center; justify-content: space-between; gap: 18px; min-height: 96px; padding: 16px 18px; border-top: 1px solid var(--line); }
.overview-first-task-copy { display: grid; min-width: 0; gap: 5px; }
.overview-first-task-copy strong { font-size: 12px; font-weight: 550; }
.overview-first-task-copy span { color: var(--muted); font-size: 12px; line-height: 1.45; }
.overview-first-task button { flex: 0 0 auto; min-height: 42px; }
.overview-recent-item { display: grid; grid-template-columns: 36px minmax(0, 1fr) auto; align-items: center; gap: 10px; width: 100%; min-height: 70px; padding: 10px 16px; border: 0; border-top: 1px solid var(--line); border-radius: 0; text-align: left; }
.overview-active-item { border: 1px solid var(--line); border-radius: 8px; }
.overview-recent-item:hover { background: var(--raised); }
.overview-recent-avatar { width: 36px; height: 36px; }
.overview-recent-copy { display: grid; min-width: 0; gap: 2px; }
.overview-recent-copy strong, .overview-recent-copy span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.overview-recent-copy strong { font-size: 11px; font-weight: 550; }
.overview-recent-copy span { color: var(--muted); font-size: 11px; }
.overview-recent-tail { display: grid; justify-items: end; gap: 5px; }
.overview-recent-tail time { font-size: 10px; }
@media (max-width: 860px) {
  .overview-panels { grid-template-columns: minmax(0, 1fr); }
  .overview-attention { min-height: 0; }
  .overview-attention[data-has-items="true"] { order: -2; }
  .overview-active-work { grid-column: auto; order: -1; }
  .overview-team { order: 1; }
}
@media (max-width: 560px) {
  .overview-shell { padding-top: 22px; }
  .overview-intro { align-items: flex-start; flex-direction: column; gap: 16px; }
  .overview-intro .actions { display: grid; width: 100%; grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .overview-intro .actions button { width: 100%; min-height: 44px; }
  .overview-draft-item { grid-template-columns: minmax(0, 1fr); gap: 6px; padding-inline: 12px; }
  .overview-draft-action { justify-self: start; }
  .overview-metric { padding-right: 8px; }
  .overview-metric + .overview-metric { padding-left: 10px; }
  .overview-metric strong { font-size: 21px; }
  .overview-pod { grid-template-columns: minmax(0, 1fr) 44px; gap: 6px; }
  .overview-pod-open { grid-template-columns: 42px minmax(0, 1fr); gap: 10px; min-height: 72px; padding: 10px 0 10px 12px; }
  .overview-avatar { width: 42px; height: 42px; }
  .overview-pod-new-task { width: 44px; min-height: 44px; margin-right: 0; padding: 0; font-size: 0; }
  .overview-pod-new-task::before { content: "+"; font-size: 20px; line-height: 1; }
  .overview-first-task { align-items: stretch; flex-direction: column; gap: 12px; padding: 14px 12px; }
  .overview-first-task button { width: 100%; min-height: 44px; }
  .overview-recent-item { grid-template-columns: 34px minmax(0, 1fr); gap: 9px 10px; padding-inline: 12px; }
  .overview-recent-avatar { width: 34px; height: 34px; }
  .overview-recent-copy span { display: -webkit-box; overflow: hidden; white-space: normal; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
  .overview-recent-tail { grid-column: 2; display: flex; align-items: center; justify-items: start; gap: 8px; }
  .overview-attention-item { grid-template-columns: 36px minmax(0, 1fr); align-items: start; }
  .overview-attention-copy span { display: -webkit-box; white-space: normal; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
  .overview-attention-action { grid-column: 2; justify-self: start; }
}
.starter-prompts { width: min(800px, 100%); margin: 0 auto 10px; }
.starter-prompts[hidden] { display: none; }
.starter-prompts > .eyebrow { margin: 0 0 6px 4px; color: var(--subtle); font-size: 10px; }
.starter-prompts .suggestions { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.starter-prompts .task-starter { min-height: 68px; grid-template-columns: 20px minmax(0, 1fr); grid-template-rows: auto auto; align-content: center; gap: 4px 8px; padding: 8px 10px; }
.starter-prompts .task-starter-index { grid-row: 1 / 3; align-self: center; }
.starter-prompts .task-starter strong { font-size: 12px; }
.starter-prompts .task-starter-detail { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.task-starter { display: grid; grid-template-rows: auto auto 1fr; align-content: start; justify-items: start; gap: 7px; min-width: 0; min-height: 112px; padding: 12px; border-color: var(--line); background: var(--surface); text-align: left; }
.task-starter:hover { border-color: var(--muted); background: var(--raised); }
.task-starter-index { color: var(--green); font-size: 10px; font-variant-numeric: tabular-nums; }
.task-starter strong { font-size: 13px; font-weight: 550; }
.task-starter-detail { color: var(--muted); font-size: 11px; line-height: 1.45; }
@media (max-width: 760px) { .starter-prompts .suggestions { display: flex; overflow-x: auto; padding-bottom: 3px; scroll-snap-type: x mandatory; scrollbar-width: thin; } .starter-prompts .task-starter { flex: 0 0 min(220px, 78vw); min-height: 44px; grid-template-columns: 18px minmax(0, 1fr); grid-template-rows: 1fr; align-items: center; gap: 8px; scroll-snap-align: start; } .starter-prompts .task-starter-index { grid-row: auto; align-self: auto; } .starter-prompts .task-starter-detail { display: none; } }
#composer { position: relative; padding: 14px 36px 20px; background: var(--canvas); }
.composer-field { width: min(800px, 100%); display: flex; align-items: flex-end; gap: 8px; margin: auto; padding: 10px; border: 1px solid var(--strong); border-radius: 14px; background: var(--soft); }
.composer-field:focus-within { border-color: var(--muted); }
#composer textarea { flex: 1; min-height: 44px; max-height: 160px; padding: 10px 8px; border: 0; background: transparent; resize: vertical; outline: none; }
#composer .composer-field button { width: 36px; min-width: 36px; height: 36px; min-height: 36px; padding: 0; margin-bottom: 4px; border-radius: 50%; font-size: 20px; }
.composer-hint { width: min(800px, 100%); margin: 8px auto 0; color: var(--subtle); font-size: 11px; text-align: left; }
.command-menu { position: absolute; right: 36px; bottom: calc(100% - 8px); left: 36px; z-index: 4; width: min(800px, calc(100% - 72px)); max-height: 300px; margin: auto; padding: 6px; overflow: auto; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); box-shadow: 0 12px 36px #0003; }
.command-option { display: grid; grid-template-columns: 110px minmax(0, 1fr); width: 100%; min-height: 38px; padding: 8px 10px; border: 0; text-align: left; }
.command-option[aria-selected="true"], .command-option:hover { background: var(--raised); }
.command-option code { color: var(--ink); font-size: 12px; }
.command-option span { overflow: hidden; color: var(--muted); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
#settings-dialog { width: min(820px, calc(100% - 28px)); padding: 28px; overflow: auto; }
#settings-dialog .editor-heading h2 { margin-bottom: 6px; }
.settings-section { margin-top: 20px; padding-top: 18px; border-top: 1px solid var(--line); }
.settings-section > h3, .settings-section .row h3 { font-size: 13px; }
.settings-section > .muted, #settings-scope-hint { margin-top: 5px; }
#provider-settings { margin-top: 14px; }
.provider-controls { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; align-items: end; }
.provider-controls label { margin: 0; }
.provider-controls .provider-model { grid-column: 1 / -1; }
.provider-controls .actions { grid-column: 1 / -1; margin-top: 0; }
.settings-profile-state { margin: 8px 0 12px; color: var(--muted); font-size: 11px; }
.settings-scope-label { width: 145px; margin: 0; font-size: 11px; }
.settings-group { margin-top: 14px; }
.settings-group h4 { margin: 0 0 5px; color: var(--muted); font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; }
.setting-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(180px, 260px); gap: 4px 18px; align-items: center; padding: 12px 0; border-bottom: 1px solid var(--line); }
.setting-row > label { margin: 0; color: var(--ink); font-size: 12px; }
.setting-row > label span { display: block; margin-top: 3px; color: var(--muted); font-size: 10px; font-weight: 400; }
.setting-control { display: flex; align-items: center; gap: 6px; }
.setting-control input, .setting-control select { min-width: 0; width: 100%; height: 34px; margin: 0; padding: 5px 8px; font-size: 12px; }
.setting-control input[type="checkbox"] { width: 18px; height: 18px; margin-right: auto; }
.setting-actions { display: flex; grid-column: 2; justify-content: flex-end; gap: 6px; }
.setting-actions button, .provider-controls button { min-height: 29px; padding: 4px 9px; font-size: 10px; }
.setting-origin { grid-column: 1; color: var(--subtle); font-size: 10px; }
#command-help { display: grid; grid-template-columns: minmax(110px, .35fr) 1fr; gap: 0 14px; margin-top: 14px; }
#command-help code, #command-help span { padding: 9px 0; border-bottom: 1px solid var(--line); font-size: 11px; }
#command-help code { color: var(--ink); }
#command-help span { color: var(--muted); }
.review { min-height: 0; overflow: auto; padding: 20px 18px; border-left: 1px solid var(--line); background: var(--surface); }
.review-panel-header { display: flex; align-items: center; justify-content: space-between; padding-bottom: 16px; }
.review-panel-header .eyebrow { color: var(--ink); font-size: 16px; font-weight: 550; }
.review-panel-header button { border: 0; color: var(--muted); font-size: 11px; }
.review section { padding: 18px 0; border-bottom: 1px solid var(--line); }
.review h2 { margin-bottom: 12px; font-size: 13px; }
.review[data-view="activity"] > [data-view]:not([data-view="activity"]), .review[data-view="scheduled"] > [data-view]:not([data-view="scheduled"]), .review[data-view="library"] > [data-view]:not([data-view="library"]), .review[data-view="profile"] > [data-view]:not([data-view="profile"]) { display: none; }
.activity-summary { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 14px; }
.activity-stat { color: var(--muted); font-size: 10px; }
.activity-stat b { color: var(--ink); font-variant-numeric: tabular-nums; }
.run-count { color: var(--subtle); font-size: 10px; }
.decision { padding: 15px 0; border-top: 1px solid var(--line); }
.decision h3 { color: var(--amber); }
.decision > .muted { margin-top: 6px; }
.routine, .note { margin-top: 10px; padding: 14px 0; border-bottom: 1px solid var(--line); font-size: 13px; }
.routine p, .note p { margin-top: 5px; overflow-wrap: anywhere; }
.routine .actions button, .note button { font-size: 10px; padding: 5px 8px; min-height: 30px; }
#activity-list > div { padding: 12px 0; border-bottom: 1px solid var(--line); font-size: 11px; }
#activity-list details { margin-top: 5px; }
dialog { width: min(550px, calc(100% - 28px)); max-height: 90dvh; padding: 28px; border: 1px solid var(--line); border-radius: 12px; background: var(--canvas); color: var(--ink); box-shadow: 0 20px 80px #0005; }
dialog::backdrop { background: #0007; }
dialog h2 { margin-bottom: 18px; font-size: 20px; }
dialog .muted { margin-bottom: 10px; }
.delete-confirm-instruction { margin: 16px 0 8px; color: var(--ink); font-size: 13px; }
.delete-confirm-instruction code { padding: 2px 6px; border-radius: 4px; background: var(--surface); overflow-wrap: anywhere; }
#delete-confirm-form .actions { justify-content: flex-end; padding-top: 12px; border-top: 1px solid var(--line); }
#delete-confirm-submit { min-height: 44px; }
@media (max-width: 560px) { #delete-confirm-dialog { padding: 20px; } #delete-confirm-form .actions { flex-direction: column; } #delete-confirm-form .actions button { width: 100%; min-height: 44px; } }
#quick-open-dialog { width: min(560px, calc(100vw - 24px)); max-height: min(82dvh, 680px); overflow: hidden; padding: 0; border-radius: 14px; }
#quick-open-dialog[open] { display: flex; flex-direction: column; }
#quick-open-dialog::backdrop { background: #0009; backdrop-filter: blur(3px); }
#folder-picker-dialog { display: none; width: min(620px, calc(100vw - 24px)); height: min(720px, calc(100dvh - 32px)); max-height: calc(100dvh - 32px); overflow: hidden; padding: 0; }
#folder-picker-dialog[open] { display: flex; flex-direction: column; }
.folder-picker-head { flex: 0 0 auto; padding: 24px 28px 14px; border-bottom: 1px solid var(--line); }
.folder-picker-title-row h2 { margin: 0; }
#folder-picker-path { display: block; margin: 12px 0 0; padding: 8px 10px; border-radius: 7px; background: var(--surface); color: var(--muted); font-size: 11px; overflow-wrap: anywhere; }
#folder-picker-search { margin-top: 12px; }
#folder-picker-results { flex: 1 1 auto; min-height: 0; display: grid; align-content: start; gap: 4px; overflow-y: auto; overscroll-behavior: contain; padding: 12px 18px; }
.folder-picker-entry { display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%; min-height: 48px; padding-inline: 12px; text-align: left; }
.folder-picker-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.folder-picker-arrow { flex: 0 0 auto; color: var(--subtle); }
#folder-picker-status { flex: 0 0 auto; margin: 0; padding: 8px 24px; }
#folder-picker-actions { display: flex; justify-content: space-between; gap: 8px; flex: 0 0 auto; margin: 0; padding: 12px 24px max(16px, env(safe-area-inset-bottom)); border-top: 1px solid var(--line); background: var(--canvas); }
#folder-picker-actions button { min-height: 44px; }
#assign-task-dialog { width: min(560px, calc(100vw - 24px)); max-height: calc(100dvh - max(16px, env(safe-area-inset-top)) - max(16px, env(safe-area-inset-bottom))); overflow: hidden; padding: 0; }
#assign-task-dialog[open] { display: flex; flex-direction: column; }
#assign-task-dialog .editor-heading { flex: 0 0 auto; padding: 24px 28px 12px; }
#assign-task-dialog .editor-heading h2 { margin-bottom: 8px; }
#assign-task-dialog .editor-heading p.muted { margin-bottom: 0; }
#assign-task-form { display: flex; flex-direction: column; gap: 14px; min-height: 0; flex: 1 1 auto; overflow-y: auto; overscroll-behavior: contain; padding: 0 28px 16px; }
#assign-task-form label { margin: 0; }
#assign-task-form label[for="assign-task-message"] { display: flex; flex: 1; flex-direction: column; min-height: 0; }
#assign-task-form textarea { min-height: 150px; flex: 1; resize: vertical; }
#assign-task-context, #assign-task-form .muted, #assign-task-form .error { margin: 0; }
#assign-task-context { overflow-wrap: anywhere; }
#assign-task-starter-label { color: var(--subtle); font-size: 10px; }
#assign-task-starters { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
.assign-task-starter { display: grid; align-content: center; justify-items: start; gap: 4px; min-width: 0; min-height: 68px; padding: 7px 9px; border-color: var(--line); text-align: left; }
.assign-task-starter strong { font-size: 11px; font-weight: 550; }
.assign-task-starter span { color: var(--muted); font-size: 10px; line-height: 1.3; }
#assign-task-actions { flex: 0 0 auto; margin: 0; padding: 12px 28px max(16px, env(safe-area-inset-bottom)); border-top: 1px solid var(--line); background: var(--canvas); }
@media (max-width: 760px) { #assign-task-starters { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 4px; scroll-snap-type: x mandatory; scrollbar-width: thin; } .assign-task-starter { flex: 0 0 min(240px, 78vw); min-height: 72px; justify-items: start; gap: 5px; padding: 9px 11px; scroll-snap-align: start; text-align: left; } .assign-task-starter strong { font-size: 12px; line-height: 1.3; } .assign-task-starter span { display: block; font-size: 10px; line-height: 1.35; } }
.quick-open-head { padding: 22px 22px 12px; }
.quick-open-head .eyebrow { margin: 0 0 4px; color: var(--green); font-size: 10px; letter-spacing: .14em; }
.quick-open-title-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; }
.quick-open-title-row h2 { margin: 0 0 16px; font-size: 19px; font-weight: 550; }
#quick-open-close { display: none; }
#quick-open-search { width: 100%; min-height: 48px; margin: 0; padding: 10px 12px; font-size: 14px; }
#quick-open-results { min-height: 48px; overflow: auto; padding: 4px 8px; }
.quick-open-option { display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%; min-height: 50px; padding: 8px 12px; border-color: transparent; text-align: left; }
.quick-open-option[aria-selected="true"] { background: var(--raised); }
.quick-open-option-label { min-width: 0; overflow: hidden; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
.quick-open-option-detail { flex: 0 1 auto; overflow: hidden; color: var(--muted); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
#quick-open-empty { margin: 0; padding: 16px 12px; color: var(--muted); font-size: 12px; }
#quick-open-help { flex: 0 0 auto; margin: 0; padding: 10px 22px 18px; color: var(--subtle); font-size: 11px; }
#workspace-history-dialog { width: min(760px, calc(100vw - 24px)); max-height: min(84dvh, 760px); overflow: hidden; padding: 0; border-radius: 14px; }
#workspace-history-dialog[open] { display: flex; flex-direction: column; }
#workspace-history-dialog .quick-open-head { flex: 0 0 auto; }
#workspace-history-form { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: end; gap: 10px; }
#workspace-history-form label { min-width: 0; margin: 0; }
#workspace-history-form label span { display: block; margin-bottom: 5px; color: var(--muted); font-size: 12px; }
#workspace-history-form input, #workspace-history-form button { min-height: 44px; }
#workspace-history-form button { min-width: 92px; }
#workspace-history-status { flex: 0 0 auto; margin: 0; padding: 0 22px 12px; }
#workspace-history-results { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 0 22px; overscroll-behavior: contain; }
.history-result { margin: 0; padding: 14px 0; border-top: 1px solid var(--line); }
.history-result-meta { display: flex; flex-wrap: wrap; gap: 6px 12px; color: var(--muted); font-size: 11px; }
.history-result-prompt { margin-top: 8px; padding: 10px 12px; border-radius: 8px; background: var(--soft); font-size: 13px; overflow-wrap: anywhere; }
.history-result-output { margin-top: 8px; color: var(--muted); font-size: 12px; overflow-wrap: anywhere; }
.history-result .actions { margin-top: 8px; }
.history-summary { display: grid; gap: 10px; margin-top: 12px; }
.history-summary-turn { width: min(100%, 720px); padding: 12px 14px; border: 1px solid var(--line); border-radius: 10px; background: var(--surface); }
.history-summary-turn.user { width: min(88%, 620px); justify-self: end; background: var(--soft); }
.history-summary-speaker { display: block; margin-bottom: 6px; color: var(--muted); font-size: 11px; font-weight: 600; }
.history-summary-prompt { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.history-summary-turn .answer { font-size: 13px; line-height: 1.65; }
.history-summary-error { padding: 10px 12px; border: 1px solid var(--red); border-radius: 9px; color: var(--red); white-space: pre-wrap; overflow-wrap: anywhere; }
#workspace-history-actions { flex: 0 0 auto; display: flex; justify-content: flex-end; margin: 0; padding: 12px 22px max(16px, env(safe-area-inset-bottom)); border-top: 1px solid var(--line); }
#mobile-conversations-dialog { width: min(560px, calc(100vw - 24px)); max-height: min(82dvh, 680px); overflow: hidden; padding: 0; border-radius: 14px; }
#mobile-conversations-dialog[open] { display: flex; flex-direction: column; }
#mobile-conversations-dialog::backdrop { background: #0009; backdrop-filter: blur(3px); }
.mobile-conversations-head { flex: 0 0 auto; padding: 20px 22px 14px; border-bottom: 1px solid var(--line); }
.mobile-conversations-title-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.mobile-conversations-title-row .eyebrow { margin-bottom: 5px; color: var(--green); font-size: 10px; letter-spacing: .12em; }
.mobile-conversations-title-row h2 { margin: 0; font-size: 20px; }
.mobile-conversations-title-row button { min-height: 40px; }
.mobile-conversations-pod { margin: 4px 0 0; color: var(--muted); font-size: 12px; }
.mobile-conversations-tools { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: end; gap: 8px; margin-top: 14px; }
.mobile-conversations-tools label { min-width: 0; margin: 0; color: var(--muted); font-size: 11px; }
.mobile-conversations-tools input, .mobile-conversations-tools button { min-height: 44px; }
.mobile-conversations-tools input { margin-top: 5px; }
#mobile-conversations-count { margin: 9px 0 0; color: var(--subtle); font-size: 11px; }
#mobile-conversations-list { flex: 1 1 auto; min-height: 0; display: grid; align-content: start; gap: 7px; overflow: auto; margin: 0; padding: 12px 22px max(16px, env(safe-area-inset-bottom)); list-style: none; overscroll-behavior: contain; }
.mobile-conversation-option { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 12px; width: 100%; min-height: 62px; padding: 10px 12px; border-color: var(--line); background: var(--surface); text-align: left; }
.mobile-conversation-option[aria-current="true"] { border-color: var(--strong); background: var(--raised); }
.mobile-conversation-copy { display: grid; min-width: 0; gap: 3px; }
.mobile-conversation-copy strong { display: flex; align-items: center; gap: 7px; min-width: 0; overflow: hidden; font-size: 13px; font-weight: 550; }
.mobile-conversation-copy strong > span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mobile-conversation-time { color: var(--muted); font-size: 10px; white-space: nowrap; }
.mobile-chat-action { color: var(--green); font-size: 11px; font-weight: 600; }
.mobile-chat-more { padding: 10px; color: var(--muted); font-size: 11px; text-align: center; }
.mobile-conversation-current-badge { flex: 0 0 auto; padding: 2px 6px; border-radius: 5px; background: var(--green-wash); color: var(--green); font-size: 9px; }
.mobile-conversation-empty { display: grid; justify-items: start; gap: 8px; margin: auto; padding: 24px 8px; }
.mobile-conversation-empty strong { font-size: 15px; }
.mobile-conversation-empty span { max-width: 36ch; color: var(--muted); font-size: 12px; line-height: 1.45; }
@media (max-width: 560px) {
  #workspace-history-dialog { width: calc(100vw - 16px); max-height: calc(100dvh - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 16px); }
  #workspace-history-dialog .quick-open-head { padding-inline: 18px; }
  #workspace-history-form { grid-template-columns: minmax(0, 1fr); }
  #workspace-history-form button { width: 100%; }
  #workspace-history-status, #workspace-history-results { padding-inline: 18px; }
  #workspace-history-actions { padding-inline: 18px; }
}
#routine-dialog { width: min(550px, calc(100% - 16px)); max-height: calc(100dvh - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 16px); overflow: hidden; padding: 0; }
#routine-dialog[open] { display: flex; flex-direction: column; }
#routine-form { min-height: 0; flex: 1 1 auto; overflow-y: auto; overscroll-behavior: contain; padding: 24px 28px 10px; scrollbar-width: thin; }
#routine-actions { flex: 0 0 auto; margin: 0; padding: 12px 28px max(16px, env(safe-area-inset-bottom)); border-top: 1px solid var(--line); background: var(--canvas); }
.routine-preview { display: flex; align-items: flex-start; gap: 11px; margin: 16px 0; padding: 12px; border: 1px solid var(--line); border-left: 3px solid var(--green); border-radius: 9px; background: var(--surface); }
.routine-preview-mark { display: grid; flex: 0 0 auto; place-items: center; width: 26px; height: 26px; border-radius: 7px; background: var(--green-wash); color: var(--green); font-size: 15px; }
.routine-preview .eyebrow { margin-bottom: 3px; color: var(--green); }
.routine-preview-copy { min-width: 0; overflow-wrap: anywhere; color: var(--ink); font-size: 12px; line-height: 1.5; }
@media (max-width: 560px) { #routine-form { padding: 18px 20px 8px; } #routine-actions { padding-inline: 20px; } #routine-actions button { min-height: 44px; } }
#browser-dialog { position: fixed; inset: 58px 0 0 auto; width: min(44vw, 640px); height: calc(100dvh - 58px); max-height: none; margin: 0; padding: 22px; border-radius: 0; overflow: auto; box-shadow: none; background: var(--surface); }
#browser-dialog.expanded { width: calc(100vw - 252px); }
#browser-dialog h2 { margin-bottom: 0; font-size: 16px; }
#browser-dialog[data-held="false"] #browser-image { cursor: default; }
#browser-dialog[data-held="true"] #browser-image { cursor: crosshair; }
#browser-image { display: block; width: 100%; margin: 18px 0; border: 1px solid var(--line); border-radius: 12px; }
#browser-navigation, #browser-text { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; align-items: end; margin-top: 18px; }
#browser-navigation label, #browser-text label { margin: 0; }
.group-messages { max-height: 48dvh; overflow: auto; padding: 12px; border-radius: 12px; background: var(--surface); }
.group-message { padding: 12px 0; border-bottom: 1px solid var(--line); white-space: pre-wrap; overflow-wrap: anywhere; }
.group-members { display: flex; flex-wrap: wrap; gap: 12px; margin: 12px 0; }
.group-welcome { width: min(760px, 100%); margin: clamp(24px, 8vh, 88px) auto 0; }
.group-welcome h2 { margin-bottom: 6px; font-size: 22px; letter-spacing: -.03em; }
.group-welcome-copy { margin-bottom: 14px; color: var(--muted); font-size: 13px; }
.group-starters { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.group-starter { display: grid; align-content: start; justify-items: start; gap: 6px; min-width: 0; min-height: 100px; padding: 12px; border-color: var(--line); background: var(--surface); text-align: left; }
.group-starter strong { font-size: 12px; font-weight: 550; }
.group-starter span { color: var(--muted); font-size: 11px; line-height: 1.4; }
.group-welcome-note { margin-top: 10px; color: var(--subtle); font-size: 11px; }
/* Real, locally bundled 3D meshes; color belongs to the character. */
.pod-avatar { flex: 0 0 auto; display: inline-grid; place-items: center; width: 40px; height: 40px; border: 0; background: transparent; }
.pod-avatar > canvas { display: block; width: 100%; height: 100%; }
.agent-avatar { width: 60px; height: 60px; }
.reply-avatar { width: 42px; height: 42px; }
.pod-avatar.hero-avatar { width: 152px; height: 152px; filter: drop-shadow(0 10px 12px #0002); }
.pod-avatar.editor-avatar { width: 280px; height: 280px; }
.editor-avatar canvas { cursor: grab; touch-action: none; border-radius: 18px; }
.editor-avatar canvas:active { cursor: grabbing; }
.pod-avatar[data-state="paused"] { opacity: .6; }
.preview-caption { text-align: center; }
.preview-caption .muted { display: block; font-size: 11px; }
.preview-caption > p { color: var(--ink); font-size: 18px; font-weight: 550; letter-spacing: -.02em; }
.preview-caption button { margin-top: 8px; font-size: 11px; min-height: 28px; }
/* One quiet studio surface: the character supplies shape, texture and color. */
#appearance-dialog, #create-dialog { width: min(980px, calc(100% - 28px)); padding: 28px 32px; border-radius: 14px; }
#create-dialog { height: min(880px, calc(100dvh - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 16px)); max-height: calc(100dvh - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 16px); overflow: hidden; padding-bottom: 0; }
#create-dialog[open] { display: grid; grid-template-rows: minmax(0, 1fr) auto; }
#create-form { min-height: 0; overflow-y: auto; overscroll-behavior: contain; scrollbar-gutter: stable; padding-bottom: 24px; scrollbar-width: thin; scrollbar-color: var(--strong) transparent; }
#create-form::-webkit-scrollbar { width: 6px; }
#create-form::-webkit-scrollbar-thumb { border-radius: 6px; background: var(--strong); }
.editor-heading { grid-column: 1 / -1; margin-bottom: 4px; }
.editor-heading .eyebrow { display: none; }
.editor-heading h2 { margin: 0 0 8px; font-size: 24px; font-weight: 600; letter-spacing: -.03em; }
.editor-heading .muted { font-size: 13px; }
#appearance-form { display: grid; grid-template-columns: minmax(0, 280px) minmax(0, 1fr); gap: 20px 28px; }
#appearance-form > .error, #appearance-form > .actions { grid-column: 1 / -1; }
.appearance-preview { display: grid; align-content: center; justify-items: center; padding: 16px 0; }
#appearance-preview, #create-avatar-preview { align-self: start; position: sticky; top: 0; }
.appearance-grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: 20px; }
.appearance-options { min-width: 0; margin: 0; padding: 0; border: 0; }
.appearance-options legend { margin-bottom: 8px; color: var(--ink); font-size: 13px; font-weight: 500; }
.choice-grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 6px; }
.appearance-choice { position: relative; display: grid; align-content: center; justify-items: center; min-height: 44px; margin: 0; padding: 5px 2px; border: 1px solid transparent; border-radius: 6px; cursor: pointer; transition: background .15s ease, border-color .15s ease; }
.appearance-choice:hover { background: var(--soft); }
.appearance-choice:has(input:checked) { border-color: var(--muted); background: var(--soft); }
.appearance-choice:has(input:focus-visible) { outline: 2px solid var(--accent); outline-offset: 2px; }
.appearance-choice input { position: absolute; width: 1px; height: 1px; margin: 0; opacity: 0; }
.choice-avatar { width: 52px; height: 52px; pointer-events: none; }
.choice-name { font-size: 11px; font-weight: 400; white-space: nowrap; color: var(--muted); }
.appearance-choice:has(input:checked) .choice-name { color: var(--ink); font-weight: 600; }
.options-tone .choice-grid { grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 2px; }
.options-tone .choice-name { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
.color-swatch { position: relative; display: block; width: 26px; height: 26px; border-radius: 50%; border: 1px solid #0002; }
.options-tone input:checked + .color-swatch::after { position: absolute; top: 5px; left: 9px; width: 5px; height: 10px; border: solid #222; border-width: 0 2px 2px 0; transform: rotate(45deg); content: ""; }
.options-accessory .choice-grid { grid-template-columns: repeat(5, minmax(0, 1fr)); }
.options-eyes .choice-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.options-eyes .choice-name { font-size: 12px; }
.create-job { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 18px; margin: 12px 0; }
.create-job label { margin-bottom: 0; }
.project-folder-field { min-width: 0; }
.project-folder-entry { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: end; gap: 8px; }
.project-folder-entry label { min-width: 0; margin-bottom: 0; }
.project-folder-entry > button { min-height: 42px; }
#project-folder-reuse { margin-top: 8px; }
#project-folder-reuse > summary { width: max-content; max-width: 100%; color: var(--muted); font-size: 11px; }
.project-folder-options { display: grid; gap: 6px; max-height: 180px; overflow: auto; margin-top: 8px; overscroll-behavior: contain; }
.project-folder-option { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 8px 12px; width: 100%; padding: 8px 10px; background: var(--surface); text-align: left; }
.project-folder-option-name { min-width: 0; overflow: hidden; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.project-folder-option-path { min-width: 0; overflow: hidden; color: var(--muted); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.project-folder-status { margin-top: 5px; color: var(--muted); font-size: 10px; }
#pod-templates { margin: 16px 0 18px; }
#pod-templates h3 { font-size: 13px; font-weight: 550; }
.pod-template-hint { margin-top: 2px; color: var(--muted); font-size: 11px; }
.create-draft-fresh { min-height: 38px; margin-top: 6px; color: var(--muted); font-size: 11px; }
.pod-template-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin-top: 10px; }
.pod-template { display: grid; grid-template-columns: 28px minmax(0, 1fr); align-items: center; gap: 3px 9px; min-height: 72px; padding: 10px; border-color: var(--line); background: var(--surface); text-align: left; }
.pod-template:hover { border-color: var(--strong); background: var(--soft); }
.pod-template-mark { display: grid; grid-row: 1 / span 2; place-items: center; width: 28px; height: 28px; border-radius: 8px; background: var(--raised); color: var(--accent); font-size: 10px; font-weight: 600; }
.pod-template strong { min-width: 0; font-size: 12px; line-height: 1.3; }
.pod-template-copy { grid-column: 2; color: var(--muted); font-size: 10px; line-height: 1.4; }
.pod-template-selection { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 8px; padding: 6px 9px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); }
.pod-template-selection strong { font-size: 12px; font-weight: 550; }
.pod-template-selection button { min-height: 44px; padding: 6px 10px; font-size: 11px; }
#create-appearance, #create-first-task { border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
#create-appearance > summary, #create-first-task > summary { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 14px 0; color: var(--ink); font-size: 13px; font-weight: 550; }
#create-first-task label { margin: 4px 0 8px; color: var(--ink); }
#create-first-task textarea { min-height: 100px; }
#create-first-task > p { padding-bottom: 14px; }
.create-optional { color: var(--muted); font-size: 11px; font-weight: 400; }
.create-appearance-content { display: grid; grid-template-columns: minmax(0, 220px) minmax(0, 1fr); align-items: start; gap: 24px; padding: 12px 0 16px; border-top: 1px solid var(--line); }
.create-appearance-content #create-avatar-preview { margin: 0; border-radius: 9px; }
.create-appearance-options { min-width: 0; }
.create-looks-label { margin: 0 0 8px; color: var(--muted); font-size: 11px; }
.create-look-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; margin-bottom: 12px; }
.create-look { display: grid; grid-template-columns: 20px minmax(0, 1fr); grid-template-rows: 1fr 1fr; align-items: center; gap: 2px 8px; min-width: 0; min-height: 54px; padding: 7px 8px; border-color: var(--line); background: var(--surface); text-align: left; }
.create-look[aria-pressed="true"] { border-color: var(--strong); background: var(--raised); }
.create-look-swatch { grid-row: 1 / span 2; width: 20px; height: 20px; border-radius: 7px; box-shadow: inset 0 0 0 1px #0002; }
.create-look strong { overflow: hidden; font-size: 11px; font-weight: 550; text-overflow: ellipsis; white-space: nowrap; }
.create-look-detail { overflow: hidden; color: var(--muted); font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }
#create-avatar-preview .editor-avatar { width: 180px; height: 180px; }
#create-form > details { margin: 18px 0 12px; }
#create-actions { position: relative; z-index: 2; align-self: end; margin: 0; padding: 12px 0 max(12px, env(safe-area-inset-bottom)); background: var(--canvas); box-shadow: 0 -10px 22px rgb(0 0 0 / 14%); }
#create-avatar-preview { position: static; padding: 16px 0; margin-bottom: 20px; border-radius: 8px; background: var(--soft); }
#create-avatar-preview .editor-avatar { width: 220px; height: 220px; }
#create-avatar-preview .preview-caption > p { display: none; }
#create-avatar-preview .preview-caption .muted { font-size: 11px; }
#create-form textarea { min-height: 80px; }
.create-job .responsibility-field { grid-column: 1 / -1; }
#appearance-form > .actions, #create-actions { justify-content: flex-end; padding-top: 16px; border-top: 1px solid var(--line); }
@media (max-width: 760px) {
  #appearance-dialog, #create-dialog { padding: 20px; }
  #create-dialog { padding-bottom: 0; }
  #appearance-form { grid-template-columns: minmax(0, 1fr); gap: 14px; }
  #appearance-preview, #create-avatar-preview { position: static; padding: 16px 0; margin-bottom: 20px; border-radius: 8px; background: var(--soft); }
  .pod-avatar.editor-avatar { width: 200px; height: 200px; }
  .create-job { grid-template-columns: minmax(0, 1fr); gap: 10px; margin-top: 8px; }
  #pod-templates { margin: 8px 0; }
  .pod-template-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; margin-top: 6px; }
  .pod-template { min-height: 58px; padding: 8px; }
  .create-appearance-content { grid-template-columns: minmax(0, 1fr); gap: 10px; }
  .create-appearance-content #create-avatar-preview { padding: 8px 0; margin: 0; }
  .create-look-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
  #create-avatar-preview .editor-avatar { width: 150px; height: 150px; }
  .choice-grid { grid-template-columns: repeat(5, minmax(0, 1fr)); }
  .options-tone .choice-grid { grid-template-columns: repeat(6, minmax(0, 1fr)); }
  .options-accessory .choice-grid { grid-template-columns: repeat(5, minmax(0, 1fr)); }
  .choice-avatar { width: 40px; height: 40px; }
  .choice-name { font-size: 10px; }
}

@keyframes pod-look { 50% { transform: translate(3px, -2px); } }
@keyframes breathe { 50% { opacity: .4; } }
@media (max-width: 1180px), (any-pointer: coarse), (hover: none) {
  .heading, #feed, #composer { padding-inline: 22px; }
  .feed-heading { padding-inline: 22px; }
}
@media (max-width: 1180px), (any-pointer: coarse), (hover: none) {
  #app { grid-template-rows: 58px minmax(0, 1fr) auto; }
  #app[data-onboarding="true"] { height: 100dvh; min-height: 0; grid-template-rows: 58px minmax(0, 1fr); }
  #app-layout[data-onboarding="true"] { display: flex; flex-direction: column; height: 100%; min-height: 0; }
  #app-layout[data-onboarding="true"] .workspace { flex: 1; height: 100%; min-height: 0; }
  #app-layout[data-onboarding="true"] #feed { flex: 1; min-height: 0; overflow: auto; padding: 24px clamp(18px, 4vw, 36px); }
  #app-layout[data-onboarding="true"] .empty-state { grid-template-columns: minmax(0, 1fr) 180px; gap: 12px 28px; }
  #app-layout[data-onboarding="true"] .empty-state .hero-avatar { width: 160px; height: 160px; }
  #app { height: 100dvh; min-height: 0; grid-template-rows: 58px minmax(0, 1fr); overflow: hidden; }
  .layout { display: flex; flex-direction: column; height: 100%; min-height: 0; }
  .layout.with-computer { padding-right: 0; }
  .top { position: sticky; top: 0; z-index: 5; }
  #quick-open-trigger { display: none; }
  #new-conversation-main { display: none; }
  #mobile-conversation-trigger:not([hidden]) { display: flex; }
  #mobile-new-conversation:not([hidden]) { display: grid; place-items: center; }
  #mobile-conversations-dialog { position: fixed; inset: auto 0 calc(65px + env(safe-area-inset-bottom)) 0; width: 100vw; max-width: none; height: min(72dvh, 620px); max-height: calc(100dvh - 58px - 65px - env(safe-area-inset-bottom)); margin: 0; border: 1px solid var(--line); border-bottom: 0; border-radius: 16px 16px 0 0; background: var(--surface); }
  .mobile-conversations-head { padding: max(18px, env(safe-area-inset-top)) 18px 14px; }
  #mobile-conversations-list { padding-inline: 18px; }
  #mobile-tabs { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 4px; padding: 6px 10px max(6px, env(safe-area-inset-bottom)); border-top: 1px solid var(--line); background: var(--surface); }
  #mobile-tabs button { display: grid; align-content: center; justify-items: center; gap: 3px; min-height: 52px; padding: 5px 4px; border: 0; color: var(--muted); font-size: 11px; }
  .mobile-tab-icon { display: block; width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.6; }
  #mobile-overview-tab { position: relative; }
  .mobile-tab-badge { position: absolute; top: 5px; left: calc(50% + 7px); display: grid; place-items: center; min-width: 16px; height: 16px; padding: 0 3px; border: 1px solid var(--surface); border-radius: 9px; background: var(--amber-wash); color: var(--amber); font-size: 9px; font-weight: 600; line-height: 14px; font-variant-numeric: tabular-nums; }
  .mobile-tab-label { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #mobile-tabs button[aria-current="page"] { background: var(--raised); color: var(--ink); font-weight: 600; }
  .workspace-tabs { display: none; }
  .mobile-workspace-view { display: block; width: min(100%, 220px); min-height: 40px; margin: 4px 0 4px auto; border-color: var(--line); background: var(--surface); font-size: 12px; }
  #quick-open-close { display: inline-flex; align-items: center; justify-content: center; min-width: 44px; min-height: 44px; padding-inline: 10px; }
  #app[data-onboarding="true"] #mobile-tabs { display: none; }
  #app-layout { position: relative; }
  #workspace-picker, #rail { display: none !important; }
  #create-dialog { position: fixed; inset: 0; width: 100vw; height: 100dvh; max-width: none; max-height: none; margin: 0; padding: max(18px, env(safe-area-inset-top)) clamp(18px, 4vw, 36px) 0; border: 0; border-radius: 0; }
  #create-form { padding-bottom: max(24px, env(safe-area-inset-bottom)); }
  #create-actions { margin-inline: calc(0px - clamp(18px, 4vw, 36px)); padding: 20px clamp(18px, 4vw, 36px) max(16px, env(safe-area-inset-bottom)); }
  #create-actions button { min-height: 44px; }
  .workspace { flex: 1; height: 100%; min-height: 0; }
  #feed { flex: 1; min-height: 0; overflow: auto; overscroll-behavior: contain; }
  #composer { flex: 0 0 auto; border-top: 1px solid var(--line); padding-bottom: max(14px, env(safe-area-inset-bottom)); }
  .review { position: fixed; z-index: 3; inset: auto 0 calc(53px + max(8px, env(safe-area-inset-bottom))) 0; width: 100vw; height: min(72dvh, 620px); max-height: calc(100dvh - 58px - 53px - max(8px, env(safe-area-inset-bottom))); padding: 18px 18px 20px; overflow: auto; overscroll-behavior: contain; border: 1px solid var(--line); border-bottom: 0; border-left: 0; border-radius: 18px 18px 0 0; background: var(--surface); box-shadow: 0 -18px 40px #0005; }
  #browser-dialog, #browser-dialog.expanded { position: fixed; z-index: 3; inset: 58px 0 0 auto; width: min(440px, 100vw); height: calc(100dvh - 58px); overflow: auto; background: var(--surface); box-shadow: -20px 0 40px #0003; }
  .review-panel-header { position: sticky; top: -18px; z-index: 1; margin: -18px 0 0; padding: 18px 0 14px; background: var(--surface); }
  .heading { padding-top: 18px; }
  #notice { bottom: calc(76px + env(safe-area-inset-bottom)); z-index: 6; }
}
@media (max-width: 760px) {
  #create-dialog { padding-top: max(12px, env(safe-area-inset-top)); }
  #create-first-task textarea { min-height: 64px; }
  #create-first-task label { margin-bottom: 4px; }
  #create-first-task > p { padding-bottom: 6px; }
  #create-actions { padding-top: 12px; }
}
@media (max-width: 560px) {
  #quick-open-dialog { position: fixed; inset: 0; width: 100vw; height: 100dvh; max-width: none; max-height: none; margin: 0; border: 0; border-radius: 0; }
  .mobile-conversations-title-row { align-items: center; }
  .mobile-conversations-tools { grid-template-columns: minmax(0, 1fr) auto; }
  .mobile-conversations-tools button { min-width: 136px; }
  #folder-picker-dialog { position: fixed; inset: 0; width: 100vw; height: 100dvh; max-width: none; max-height: none; margin: 0; border: 0; border-radius: 0; }
  .folder-picker-head { padding: max(18px, env(safe-area-inset-top)) 18px 14px; }
  #folder-picker-results { padding-inline: 12px; }
  #folder-picker-status { padding-inline: 18px; }
  #folder-picker-actions { display: grid; grid-template-columns: auto minmax(0, 1fr); padding-inline: 16px; }
  #assign-task-dialog { position: fixed; inset: 0; width: 100vw; height: 100dvh; max-width: none; max-height: none; margin: 0; border: 0; border-radius: 0; }
  #assign-task-dialog .editor-heading { padding: max(18px, env(safe-area-inset-top)) 20px 12px; }
  #assign-task-form { padding-inline: 20px; }
  #assign-task-actions { display: grid; grid-template-columns: 1fr; padding-inline: 20px; }
  #assign-task-actions button { min-height: 44px; }
}
@media (max-width: 360px) { .mobile-conversations-tools { grid-template-columns: minmax(0, 1fr); } .mobile-conversations-tools button { width: 100%; } .mobile-conversation-count { display: none; } }
@media (max-width: 560px) and (max-height: 680px) {
  #assign-task-dialog .editor-heading { padding-top: max(12px, env(safe-area-inset-top)); padding-bottom: 8px; }
  #assign-task-dialog .editor-heading .eyebrow { margin-bottom: 4px; }
  #assign-task-dialog .editor-heading h2 { margin-bottom: 6px; }
  #assign-task-form { gap: 8px; padding-bottom: 8px; }
  #assign-task-form textarea { min-height: 100px; }
  #assign-task-actions { gap: 6px; padding-top: 8px; padding-bottom: max(8px, env(safe-area-inset-bottom)); }
}
@media (max-width: 560px) {
  #quick-open-dialog .quick-open-head { flex: 0 0 auto; padding: max(18px, env(safe-area-inset-top)) 18px 14px; border-bottom: 1px solid var(--line); }
  .quick-open-title-row { align-items: center; }
  .quick-open-title-row h2 { margin-bottom: 0; }
  #quick-open-close { display: inline-flex; align-items: center; justify-content: center; min-width: 48px; min-height: 44px; padding-inline: 10px; }
  #quick-open-search { margin-top: 14px; }
  #quick-open-results { flex: 1 1 auto; min-height: 0; padding-inline: 12px; }
  .quick-open-option { display: grid; align-content: center; justify-content: stretch; gap: 2px; min-height: 58px; }
  .quick-open-option-detail { max-width: 100%; }
  #quick-open-help { padding: 10px 18px max(18px, env(safe-area-inset-bottom)); }
  #app[data-onboarding="true"] { height: 100dvh; min-height: 0; }
  #app-layout[data-onboarding="true"] #feed { padding: 20px; }
  #app-layout[data-onboarding="true"] .empty-state { display: flex; align-items: flex-start; flex-direction: column; width: min(100%, 440px); gap: 14px; }
  #app-layout[data-onboarding="true"] .empty-state .hero-avatar { width: 112px; height: 112px; }
  #app-layout[data-onboarding="true"] .empty-state h2 { max-width: 12ch; font-size: clamp(30px, 8vw, 36px); }
  #app-layout[data-onboarding="true"] .empty-state > p:not(.eyebrow) { font-size: 14px; }
  #app-layout[data-onboarding="true"] .onboarding-steps { width: 100%; grid-template-columns: minmax(0, 1fr); gap: 6px; margin-top: 0; }
  #app-layout[data-onboarding="true"] .onboarding-step { min-height: 38px; grid-template-columns: 28px minmax(0, 1fr); align-items: center; padding: 8px 10px; }
  #app-layout[data-onboarding="true"] .empty-state .actions, #app-layout[data-onboarding="true"] .empty-state .actions button { width: 100%; }
  .top { flex-wrap: nowrap; padding-inline: 12px; }
  .top .brand { font-size: 13px; }
  @media (max-width: 380px) { .top .brand > span { display: none; } }
  .top-actions { gap: 3px; }
  .top-actions button { padding-inline: 6px; font-size: 11px; }
  .connection { width: 6px; overflow: hidden; font-size: 0; }
  .connection::before { margin: 0; }
  .brand-mark { width: 23px; height: 23px; }
  .heading, #feed, #composer { padding-inline: 16px; }
  .heading-top { flex-wrap: wrap; gap: 8px; }
  .agent-title { flex: 1 1 100%; }
  .agent-title { gap: 10px; }
  .agent-avatar { width: 40px; height: 40px; }
  h1 { font-size: 18px; }
  .agent-actions { position: relative; width: 100%; flex-direction: row; align-items: center; justify-content: space-between; gap: 8px; }
  .agent-actions #new-conversation-main, .agent-more > summary { min-height: 44px; padding-inline: 12px; }
  .agent-actions .agent-more-actions > button { min-height: 44px; padding: 8px 10px; }
  .heading > p, .project-context { margin-left: 50px; }
  .project-context button { min-height: 44px; }
  .feed-heading { padding-inline: 16px; }
  .workspace-tabs { justify-content: space-between; gap: 12px; }
  .workspace-tabs button { font-size: 11px; }
  .prompt { max-width: 94%; }
  .empty-state { grid-template-columns: minmax(0, 1fr); gap: 12px; margin-top: 24px; }
  .empty-state .hero-avatar { grid-column: 1; grid-row: auto; justify-self: start; width: 140px; height: 140px; }
  .empty-state.has-quick-starts .hero-avatar { width: 96px; height: 96px; }
  .empty-state.has-quick-starts { grid-template-columns: 48px minmax(0, 1fr); gap: 6px 12px; margin: 0 auto; }
  .empty-state.has-quick-starts .hero-avatar { grid-column: 1; grid-row: 1 / 3; align-self: center; width: 48px; height: 48px; }
  .empty-state.has-quick-starts h2 { grid-column: 2; align-self: center; font-size: 18px; line-height: 1.3; }
  .empty-state.has-quick-starts > p:not(.eyebrow) { grid-column: 1 / -1; }
  .empty-state h2 { font-size: 22px; }
  #composer { padding-bottom: max(18px, env(safe-area-inset-bottom)); }
  .composer-field { padding: 6px; }
  #browser-navigation, #browser-text { grid-template-columns: 1fr; }
  .appearance-grid { gap: 0 10px; }
  #settings-dialog { padding: 20px; }
  .setting-row { grid-template-columns: minmax(0, 1fr); gap: 8px; }
  .setting-actions, .setting-origin { grid-column: 1; }
  .setting-actions { justify-content: flex-start; }
  .provider-controls { grid-template-columns: minmax(0, 1fr); }
  .provider-controls .provider-model, .provider-controls .actions { grid-column: 1; }
}

.result-card { margin-bottom: 12px; padding: 16px 0; border-bottom: 1px solid var(--line); }
.result-card h3 { margin-top: 6px; overflow-wrap: anywhere; }
.result-card button, .result-link { min-height: 28px; margin-top: 10px; padding: 4px 8px; font-size: 11px; }
.result-card .actions { margin-top: 12px; }
.result-card .actions button { min-height: 36px; margin-top: 0; }
.result-card a { display: block; margin-top: 8px; font-size: 12px; }
.routine-next { color: var(--green); font-size: 11px; }
.bot-details { position: relative; }
.unread-dot { display: inline-block; margin-left: 6px; font-size: 10px; color: var(--amber); }
.group-faces { display: flex; flex: 0 0 auto; }
.group-faces .pod-avatar + .pod-avatar { margin-left: -14px; }
.member-choice { display: inline-flex; align-items: center; gap: 4px; margin: 0; }
.group-header-actions { display: flex; flex: 0 0 auto; gap: 6px; }
.group-header-actions button { min-height: 36px; padding-inline: 10px; font-size: 12px; }
.group-member-options { display: grid; gap: 6px; max-height: min(54dvh, 420px); overflow: auto; margin: 12px 0; padding: 1px; overscroll-behavior: contain; }
.group-member-option { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 10px; min-height: 54px; margin: 0; padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); }
.group-member-option input { margin: 0; }
.group-member-copy { display: grid; min-width: 0; gap: 2px; }
.group-member-copy strong { overflow: hidden; font-size: 12px; font-weight: 550; text-overflow: ellipsis; white-space: nowrap; }
.group-member-copy span { color: var(--muted); font-size: 10px; }
#group-members-status { margin-bottom: 10px; }
#group-members-dialog { overflow: auto; }
#group-members-form { display: flex; min-height: 0; flex-direction: column; }
#group-members-form .group-member-options { flex: 0 1 auto; }
#group-members-form .actions { flex: 0 0 auto; }
.workspace[data-group="true"] > :not(#group-dialog) { display: none !important; }
#group-dialog { display: flex; flex-direction: column; flex: 1; min-height: 0; min-width: 0; }
#group-title { font-size: 20px; }
#group-description { margin-top: 8px; overflow-wrap: anywhere; }
#group-dialog .group-messages { flex: 1; min-height: 0; max-height: none; border-radius: 0; padding: 20px 30px; background: var(--canvas); }
.group-message { display: flex; gap: 12px; border: 0; max-width: 760px; margin: 0 auto 14px; }
.group-message-content { min-width: 0; flex: 1; }
.group-message time { display: block; margin-bottom: 6px; }
#group-dialog > h3 { display: none; }
#group-artifacts { max-height: 200px; overflow: auto; padding: 0 30px 14px; }
#group-message-form { padding: 12px 30px 20px; border-top: 1px solid var(--line); }
#group-message-form textarea { min-height: 52px; max-height: 120px; }
#group-message-form .group-members { margin-top: 0; }
#group-message-form > .muted { font-size: 10px; }
@media (max-width: 760px) { .group-starters { display: flex; overflow-x: auto; padding-bottom: 4px; scroll-snap-type: x mandatory; scrollbar-width: thin; } .group-starter { flex: 0 0 min(250px, 78vw); min-height: 88px; scroll-snap-align: start; } }
@media (max-width: 560px) { #group-dialog .group-messages, #group-message-form { padding-inline: 16px; } .workspace-tabs { gap: 8px; } }
@media (max-width: 380px) { .empty-state.has-quick-starts > p:not(.eyebrow) { display: none; } }
@media (max-width: 1180px) and (max-height: 640px) {
  .heading { padding: 6px 12px; }
  .heading-top { flex-wrap: nowrap; gap: 8px; }
  .agent-title { flex: 1 1 auto; }
  .agent-actions { width: auto; flex: 0 0 auto; gap: 4px; }
  .agent-actions .agent-state, .agent-actions .agent-more { display: none; }
  #responsibility, .project-context { display: none; }
  .starter-prompts { display: block; margin-bottom: 0; }
  .starter-prompts > .eyebrow { display: none; }
  .starter-prompts .suggestions { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 2px; scroll-snap-type: x mandatory; scrollbar-width: none; }
  .starter-prompts .task-starter { flex: 0 0 min(180px, 58vw); min-height: 44px; grid-template-columns: 18px minmax(0, 1fr); grid-template-rows: 1fr; align-items: center; gap: 8px; padding: 6px 8px; scroll-snap-align: start; }
  .starter-prompts .task-starter-index { grid-row: auto; align-self: auto; }
  .starter-prompts .task-starter-detail { display: none; }
  #composer { padding: 4px 16px 0; }
  .composer-field { min-height: 48px; padding: 6px; }
  #composer textarea { min-height: 34px; max-height: 86px; padding: 6px; }
  .composer-hint { display: none; }
}
@media (max-width: 1180px) and (max-height: 440px) {
  .heading { padding-block: 4px; }
  #responsibility { display: none; }
  .agent-avatar { width: 44px; height: 44px; }
  #composer { padding-bottom: 0; }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; scroll-behavior: auto !important; }
}
</style></head><body>

<div id="notice" role="alert" hidden></div>
<section id="login" aria-labelledby="login-title"><div class="login-card"><div class="brand"><img class="brand-mark" src="/logo.png" alt="" width="32" height="28"><span>DeepSeek <b>Pods</b></span></div><p class="eyebrow">Supervisor access</p><h1 id="login-title">Sign in to your workspace</h1><p class="login-copy">Sign in to follow agent activity, send work and review requests in this workspace.</p><form id="login-form"><label class="login-token-label" for="token">Panel access token</label><div class="login-token-field"><input id="token" type="password" autocomplete="current-password" required><button id="token-visibility" type="button" aria-label="Show access token" aria-pressed="false">Show</button></div><details class="login-token-help"><summary>Where do I get this token?</summary><p>This is the panel token, not a model API key. Local panels use <code>DEEPSEEK_BOTS_TOKEN</code>; server installs print a one-time token when setup finishes.</p></details><button class="primary" type="submit">Sign in</button><p id="login-error" class="error" role="alert"></p></form></div></section>
<div id="app" hidden><header class="top row spread"><div class="brand"><img class="brand-mark" src="/logo.png" alt="" width="32" height="28"><span>DeepSeek <b>Pods</b></span></div><button id="quick-open-trigger" type="button" aria-haspopup="dialog" aria-controls="quick-open-dialog" aria-keyshortcuts="Control+K Meta+K"><span>Jump to</span><kbd>Ctrl K</kbd></button><div class="row top-actions"><span id="connection" class="connection">Connected</span><button id="theme-toggle" type="button" aria-label="Switch to light theme">Light</button><button id="logout">Sign out</button></div></header>
<div class="layout" id="app-layout"><div id="workspace-picker" class="workspace-picker" role="presentation"><nav id="rail" class="rail" aria-label="Your Pods"><div id="rail-content"><button id="overview-link" class="overview-link" type="button" aria-current="page"><span class="overview-mark" aria-hidden="true">&#9638;</span><span>Team overview</span><span id="overview-count" class="rail-count">0</span></button><label class="rail-search"><input id="pod-search" type="search" aria-label="Search Pods" placeholder="Search your Pods"></label><div class="rail-heading"><h2>Pods</h2><span id="bot-count" class="rail-count">0</span></div><div id="bots"></div><button id="new-bot" class="new">New Pod</button><div class="rail-heading conversation-heading"><h2>Conversations</h2><button id="new-conversation" class="new-conversation" type="button" aria-label="New conversation" title="New conversation">+</button></div><div id="conversations" tabindex="-1"></div><div class="rail-heading groups-heading"><h2>Group chats</h2></div><div id="group-list"></div><button id="new-group" class="new">Create group</button></div></nav></div>
<main class="workspace"><section id="mobile-pods-page" class="mobile-pods-page" aria-labelledby="mobile-pods-title" hidden><header class="mobile-pods-head"><p id="mobile-pods-eyebrow" class="eyebrow">WORKSPACE / PODS</p><h1 id="mobile-pods-title">Your Pods</h1><p id="mobile-pods-intro" class="mobile-pods-intro">Pick a Pod or open a group chat.</p><div id="mobile-workspace-switch" class="mobile-workspace-switch" role="group" aria-label="Workspace directory"><button type="button" data-mobile-workspace-view="pods" aria-pressed="true" aria-controls="mobile-pods-list">Pods<span id="mobile-roster-pod-count" class="mobile-workspace-switch-count">0</span></button><button type="button" data-mobile-workspace-view="groups" aria-pressed="false" aria-controls="mobile-pods-list">Groups<span id="mobile-roster-group-count" class="mobile-workspace-switch-count">0</span></button></div><div class="mobile-pods-tools"><input id="mobile-pods-search" type="search" aria-label="Search Pods by name, role or folder" placeholder="Search Pods" autocomplete="off"><button id="mobile-pods-create" type="button" class="primary">New Pod</button></div><div id="mobile-pods-filters" class="mobile-pods-filters" role="group" aria-label="Filter Pods by status"><button type="button" data-pods-filter="all" aria-pressed="true" aria-controls="mobile-pods-list"><span>All Pods</span><span class="mobile-pods-filter-count">0</span></button><button type="button" data-pods-filter="attention" aria-pressed="false" aria-controls="mobile-pods-list"><span>Needs you</span><span class="mobile-pods-filter-count">0</span></button><button type="button" data-pods-filter="working" aria-pressed="false" aria-controls="mobile-pods-list"><span>Working</span><span class="mobile-pods-filter-count">0</span></button><button type="button" data-pods-filter="paused" aria-pressed="false" aria-controls="mobile-pods-list"><span>Paused</span><span class="mobile-pods-filter-count">0</span></button></div><p id="mobile-pods-count" class="muted mobile-pods-count" role="status" aria-live="polite"></p></header><ul id="mobile-pods-list" class="mobile-pods-list" aria-label="Pods"></ul></section><header class="heading"><div class="heading-top"><div class="agent-title"><span id="bot-avatar" class="agent-avatar" aria-hidden="true">PO</span><div><p class="eyebrow">DeepSeek Pod</p><h1 id="bot-name">Your agents</h1></div></div><div class="agent-actions"><span id="agent-state" class="agent-state" data-state="ready">Ready</span><button id="mobile-conversation-trigger" type="button" aria-haspopup="dialog" aria-controls="mobile-conversations-dialog" aria-label="Switch conversations" hidden><span class="mobile-conversation-current"><span class="mobile-conversation-kind">Conversation</span><strong id="mobile-conversation-title">New conversation</strong></span><span id="mobile-conversation-count" class="mobile-conversation-count" aria-hidden="true">0</span><span class="mobile-conversation-chevron" aria-hidden="true"></span></button><button id="mobile-new-conversation" type="button" aria-label="New conversation" title="New conversation" hidden>+</button><button id="new-conversation-main" type="button" hidden>New conversation</button><details id="agent-more" class="agent-more" aria-label="More Pod actions" hidden><summary>More</summary><div id="agent-more-actions" class="agent-more-actions"><button id="create-similar-pod" type="button">Create similar Pod</button><button id="pod-settings" type="button" hidden>Settings</button><button id="toggle-bot" hidden>Pause new work</button></div></details></div></div><p id="responsibility" class="muted">Create an agent with a project and a responsibility to get started.</p><div id="project-context" class="project-context" hidden><span class="project-context-label">Folder</span><code id="project-root-path"></code><button id="copy-project-root" type="button" aria-label="Copy project folder path">Copy</button></div></header><div class="feed-heading"><nav class="workspace-tabs" aria-label="Pod workspace"><button type="button" data-workspace-view="conversation" aria-pressed="true">Conversation</button><button id="activity-view" type="button" data-workspace-view="activity" aria-pressed="false" aria-controls="review-panel">Activity<span id="review-count" class="review-count" hidden>0</span></button><button type="button" data-workspace-view="scheduled" aria-pressed="false">Scheduled</button><button type="button" data-workspace-view="library" aria-pressed="false">Library</button><button type="button" data-workspace-view="profile" aria-pressed="false">Profile</button></nav><select id="mobile-workspace-view" class="mobile-workspace-view" aria-label="Pod section"><option value="conversation">Conversation</option><option value="activity">Activity</option><option value="scheduled">Scheduled</option><option value="library">Library</option><option value="profile">Profile</option></select></div><div id="feed" aria-label="Pod conversation"></div>
<form id="composer" hidden><div id="command-menu" class="command-menu" role="listbox" aria-label="Slash commands" hidden></div><div id="starter-prompts" class="starter-prompts" hidden><p class="eyebrow">Quick starts</p></div><div class="composer-field"><textarea id="message" aria-label="Task or slash command for this agent" aria-autocomplete="list" aria-controls="command-menu" required maxlength="100000" placeholder="Message your Pod or type / for commands&#8230;"></textarea><button type="submit" class="primary" aria-label="Send task">&#8593;</button></div><p id="composer-hint" class="composer-hint">Enter to send &#183; Shift + Enter for a new line &#183; Type / for commands</p></form></main>
<aside id="review-panel" class="review" data-view="activity" aria-label="Pod activity and profile" hidden><div class="review-panel-header"><span id="review-title" class="eyebrow">Activity</span><button id="close-review" type="button">Close</button></div><section data-view="activity"><div class="activity-summary" role="status" aria-label="Task status summary"><span class="activity-stat"><i class="status-dot active"></i><b id="active-count">0</b> active</span><span class="activity-stat"><i class="status-dot attention"></i><b id="attention-count">0</b> attention</span><span class="activity-stat"><i class="status-dot complete"></i><b id="completed-count">0</b> complete</span><span id="run-count" class="run-count">0 tasks</span></div><h2>Needs your attention</h2><div id="decisions"><p class="muted">Requests for approval appear here.</p></div></section><section data-view="activity" id="history-section" hidden><h2>Search task history</h2><form id="history-search-form"><label>Search this agent's past tasks<input name="query" minlength="2" maxlength="128" required placeholder="A phrase or identifier"></label><button type="submit">Search</button><p class="error" role="alert"></p></form><div id="history-results"></div></section><section data-view="library"><h2>Saved results</h2><div id="library-results"></div></section><section data-view="scheduled"><div class="row spread"><h2>Routines</h2><button id="new-routine" hidden>Add routine</button></div><div id="routines"></div></section><section data-view="scheduled"><h2>Learned browser skills</h2><div id="procedures"></div></section><section data-view="profile"><div class="row spread"><h2>Memory</h2><button id="new-note" hidden>Add note</button></div><div id="notes"></div></section><section data-view="profile"><h2>Data and privacy</h2><p class="muted">Export includes this agent's saved work and activity. Browser cookies, provider credentials and private browser profile files are excluded.</p><div class="actions"><button id="export-bot" hidden>Export data</button><button id="delete-bot" class="danger" hidden>Delete agent</button></div></section><section data-view="profile"><div class="row spread"><h2>External delivery</h2><button id="new-delivery" hidden>Add webhook</button></div><p class="muted">Signed HTTPS notifications are sent when a selected task finishes. The receiver must verify the Ed25519 signature.</p><div id="deliveries"></div></section><details data-view="activity" id="activity" open><summary>Tool activity</summary><div id="activity-list"></div></details></aside>
</div><nav id="mobile-tabs" aria-label="Primary navigation"><button id="mobile-overview-tab" type="button" aria-current="page"><svg class="mobile-tab-icon" viewBox="0 0 20 20" aria-hidden="true"><rect x="2.5" y="2.5" width="6" height="6" rx="1"/><rect x="11.5" y="2.5" width="6" height="6" rx="1"/><rect x="2.5" y="11.5" width="6" height="6" rx="1"/><rect x="11.5" y="11.5" width="6" height="6" rx="1"/></svg><span id="mobile-attention-count" class="mobile-tab-badge" aria-hidden="true" hidden></span><span class="mobile-tab-label">Overview</span></button><button id="mobile-pods-tab" type="button" aria-current="false"><svg class="mobile-tab-icon" viewBox="0 0 20 20" aria-hidden="true"><rect x="2.5" y="3" width="11" height="11" rx="2"/><path d="M6 17h7a2 2 0 0 0 2-2V8"/></svg><span class="mobile-tab-label">Pods</span></button><button id="mobile-chats-tab" type="button" aria-current="false" aria-controls="mobile-pods-list"><svg class="mobile-tab-icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M3 4.5h14v10H8l-4 3v-13z"/><path d="M7 8h6M7 10.5h4"/></svg><span class="mobile-tab-label">Chats</span></button><button id="mobile-jump-tab" type="button" aria-haspopup="dialog" aria-controls="quick-open-dialog" aria-label="Jump to a Pod, group, conversation or action"><svg class="mobile-tab-icon" viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5"/><path d="m13 13 4 4"/></svg><span class="mobile-tab-label">Jump</span></button><button id="mobile-history-tab" type="button" aria-haspopup="dialog" aria-controls="workspace-history-dialog"><svg class="mobile-tab-icon" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7"/><path d="M10 6v4l2.5 1.5"/><path d="M3.5 6.5v4h4"/></svg><span class="mobile-tab-label">History</span></button></nav></div>
<dialog id="browser-dialog" data-held="false" aria-labelledby="computer-title"><div class="row spread"><h2 id="computer-title">Pod&#8217;s computer</h2><div class="row"><button id="computer-expand" type="button" aria-pressed="false">Expand</button><button type="button" data-close>Close view</button></div></div><p class="eyebrow">Codimium browser</p><p id="browser-state" class="muted"></p><div class="actions"><button id="browser-take">Take over</button><button id="browser-release">Return to agent</button><button id="browser-refresh">Refresh view</button></div><form id="browser-navigation"><label>Go to a page<input id="browser-url" type="url" required placeholder="https://example.com"></label><button type="submit">Navigate</button></form><img id="browser-image" alt="Current Codimium browser page" tabindex="0" hidden><p class="muted">Click the page to focus a field. Browser actions pause while you have control.</p><form id="browser-text"><label>Text to enter in the focused field<input id="browser-input" type="password" autocomplete="off" maxlength="16000" required></label><button type="submit">Send text to browser</button></form><div class="actions"><label>Key<select id="browser-key"><option>Enter</option><option>Tab</option><option>Backspace</option><option>Escape</option><option>ArrowDown</option><option>ArrowUp</option></select></label><button id="browser-press">Press key</button><button id="browser-up">Scroll up</button><button id="browser-down">Scroll down</button><button id="browser-accept">Accept dialog</button><button id="browser-dismiss">Dismiss dialog</button></div><label>Tab<select id="browser-tab"></select></label><p class="muted">Typed text is cleared after sending. It is never added to the agent's conversation or tool logs.</p></dialog>
<dialog id="create-dialog" aria-labelledby="create-title"><form id="create-form"><header class="editor-heading"><p class="eyebrow">NEW TEAMMATE</p><h2 id="create-title">Create a Pod</h2><p class="muted">Choose a starting role or write your own instructions. Personalize its appearance now or later.</p></header><section id="pod-templates" aria-labelledby="pod-template-title"><h3 id="pod-template-title">Start with a role</h3><p id="pod-template-status" class="pod-template-hint" role="status" aria-live="polite">Choose a role to prefill editable details.</p><div class="pod-template-grid" role="group" aria-label="Suggested Pod roles"><button type="button" class="pod-template" data-create-template="builder"><span class="pod-template-mark" aria-hidden="true">01</span><strong>Builder</strong><span class="pod-template-copy">Build features</span></button><button type="button" class="pod-template" data-create-template="reviewer"><span class="pod-template-mark" aria-hidden="true">02</span><strong>Reviewer</strong><span class="pod-template-copy">Review code</span></button><button type="button" class="pod-template" data-create-template="tester"><span class="pod-template-mark" aria-hidden="true">03</span><strong>Tester</strong><span class="pod-template-copy">Add tests</span></button><button type="button" class="pod-template" data-create-template="documenter"><span class="pod-template-mark" aria-hidden="true">04</span><strong>Docs</strong><span class="pod-template-copy">Update docs</span></button></div></section><div class="create-character"><div class="create-job"><label>Name<input name="name" required maxlength="64" pattern="[a-zA-Z0-9][a-zA-Z0-9_\-]*" placeholder="engineer"></label><div class="project-folder-field"><div class="project-folder-entry"><label>Project folder<input name="projectRoot" required placeholder="/home/you/project"></label><button id="browse-project-folder" type="button" aria-haspopup="dialog" aria-controls="folder-picker-dialog">Browse</button></div><details id="project-folder-reuse" hidden><summary>Reuse a folder from an existing Pod</summary><div id="project-folder-options" class="project-folder-options" role="group" aria-label="Existing project folders"></div></details><p id="project-folder-status" class="project-folder-status" role="status" aria-live="polite" hidden></p></div><label class="responsibility-field">What should this Pod do?<textarea name="instructions" required placeholder="Maintain this project and report observed results."></textarea></label></div><details id="create-first-task"><summary><span>Start a first task</span><span class="create-optional">Optional</span></summary><label>First task<textarea name="firstTask" maxlength="100000" placeholder="Map this project or ask for one concrete improvement."></textarea></label><p class="muted">The task starts right after this Pod is created.</p></details><details id="create-appearance"><summary><span>Customize appearance</span><span class="create-optional">Optional &#183; change anytime</span></summary><div class="create-appearance-content"><div id="create-avatar-preview" class="appearance-preview"></div><div class="create-appearance-options"><p class="create-looks-label">Choose a starting look</p><div id="create-look-presets" class="create-look-grid" role="group" aria-label="Starting appearance"></div><div id="create-appearance-fields" class="appearance-grid"></div></div></div></details></div><details><summary>Advanced settings</summary><label>Agent configuration (optional)<input name="agentConfig" placeholder="Existing configuration name"></label></details><p class="error" role="alert"></p></form><div id="create-actions" class="actions"><button id="create-submit" type="submit" form="create-form" class="primary">Create Pod</button><button type="button" data-close>Cancel</button></div></dialog>
<dialog id="folder-picker-dialog" aria-labelledby="folder-picker-title"><header class="folder-picker-head"><div class="row spread folder-picker-title-row"><div><p class="eyebrow">PROJECT FOLDER</p><h2 id="folder-picker-title">Choose a folder</h2></div><button type="button" data-close>Close</button></div><code id="folder-picker-path">Loading your home folder…</code><label>Filter folders<input id="folder-picker-search" type="search" maxlength="128" placeholder="Type a folder name"></label><label class="ui-checkbox"><input id="folder-picker-hidden" type="checkbox">Show hidden folders</label></header><div id="folder-picker-results" role="group" aria-label="Folders in this location"></div><p id="folder-picker-status" class="muted" role="status" aria-live="polite">Loading folders…</p><div id="folder-picker-actions"><button id="folder-picker-up" type="button">Up one level</button><button id="folder-picker-select" type="button" class="primary" disabled>Use this folder</button></div></dialog><dialog id="appearance-dialog" aria-labelledby="appearance-title"><form id="appearance-form"><header class="editor-heading"><p class="eyebrow">APPEARANCE</p><h2 id="appearance-title">Edit appearance</h2><p class="muted">Changes appear in your conversations and roster.</p></header><div id="appearance-preview" class="appearance-preview"></div><div id="appearance-fields" class="appearance-grid"></div><p class="error" role="alert"></p><div class="actions"><button type="submit" class="primary">Save appearance</button><button type="button" data-close>Cancel</button></div></form></dialog>
<dialog id="note-dialog"><form id="note-form"><h2>Edit saved memory</h2><label>Saved fact<textarea name="content" required maxlength="10000"></textarea></label><label>Source<input name="source" required maxlength="4096" placeholder="Where this fact was confirmed"></label><label>Expires at (optional)<input name="expiresAt" type="datetime-local" step="0.001"></label><p class="muted">Notes are references, never permission grants. Updates affect new proposals; actions already started may finish. Removing a note removes current saved memory; conversation and activity history stay available.</p><p class="error" role="alert"></p><div class="actions"><button type="submit" class="primary">Save note</button><button type="button" id="remove-note" class="danger" hidden>Remove note</button><button type="button" data-close>Cancel</button></div></form></dialog>
<dialog id="guide-dialog"><form id="guide-form"><h2>Guide this active task</h2><p class="muted">The agent will reconsider its next steps. Actions already started may finish; stop the task if you need to interrupt it.</p><label>Your correction<textarea name="message" required maxlength="100000" placeholder="What should change in the current task?"></textarea></label><p class="error" role="alert"></p><div class="actions"><button type="submit" class="primary">Send guidance</button><button type="button" data-close>Cancel</button></div></form></dialog>
<dialog id="learn-dialog"><form id="learn-form"><h2>Learn this browser procedure</h2><p class="muted">Reuse the observed steps with new inputs. Each execution checks the current page. A changed page pauses the routine for review.</p><label>Skill name<input name="name" required maxlength="64" pattern="[a-z0-9]+(-[a-z0-9]+)*" placeholder="prepare-daily-report"></label><p class="error" role="alert"></p><div class="actions"><button type="submit" class="primary">Save skill</button><button type="button" data-close>Cancel</button></div></form></dialog>
<dialog id="routine-dialog" aria-labelledby="routine-title"><form id="routine-form"><h2 id="routine-title">Add routine</h2><label>Name<input name="name" required maxlength="128"></label><label>Task<textarea name="prompt" required maxlength="10000"></textarea></label><label>Browser skill<select name="procedureId"><option value="">No browser skill</option></select></label><div id="procedure-inputs"></div><label>Schedule<select name="kind"><option value="daily">Every day</option><option value="interval">At an interval</option><option value="once">Once</option><option value="event">When an event arrives</option></select></label><div class="routine-preview" role="status" aria-live="polite" aria-atomic="true"><span class="routine-preview-mark" aria-hidden="true">&#8635;</span><div><p class="eyebrow">Schedule preview</p><p id="routine-preview-copy" class="routine-preview-copy">Every day at 08:00</p></div></div><div data-schedule="daily"><label>Time<input name="time" type="time" value="08:00"></label><label>Time zone<input name="timeZone" placeholder="America/Fortaleza"></label></div><div data-schedule="interval" hidden><label>Every (minutes)<input name="minutes" type="number" min="1" max="525600" value="60"></label></div><div data-schedule="once" hidden><label>Local date and time<input name="at" type="datetime-local"></label></div><div data-schedule="event" hidden><label>Event topic<input name="topic" placeholder="issue-created"></label></div><div data-schedule="recurring" hidden><label>Runs through (optional, your device&#8217;s local time)<input name="endsAt" type="datetime-local" step="0.001"></label></div><p class="muted">Changes apply to future occurrences. Work already queued keeps its original instructions.</p><p class="error" role="alert"></p></form><div id="routine-actions" class="actions"><button id="routine-submit" type="submit" form="routine-form" class="primary">Add routine</button><button type="button" data-close>Cancel</button></div></dialog>
<dialog id="delivery-dialog"><form id="delivery-form"><h2>Add signed webhook</h2><label>HTTPS receiver URL<input name="url" type="url" required maxlength="2048" placeholder="https://example.com/hooks/deepseek"></label><p class="muted">Use a public host on port 443. Query strings and URL credentials are not accepted. Private signing keys stay on the worker host.</p><label><input name="topics" type="checkbox" value="run.completed" checked> Completed tasks</label><label><input name="topics" type="checkbox" value="run.failed" checked> Failed tasks</label><label><input name="topics" type="checkbox" value="run.blocked" checked> Tasks blocked for review</label><p class="error" role="alert"></p><div class="actions"><button type="submit" class="primary">Add webhook</button><button type="button" data-close>Cancel</button></div></form></dialog>
<dialog id="group-create-dialog"><form id="group-create-form"><h2>Create collaboration group</h2><label>Group name<input name="name" maxlength="64" required></label><p class="muted">Select at least two enabled agents. Group messages and artifacts are shared with all selected agents.</p><div id="group-create-members" class="group-members"></div><label><input name="shareBrowser" type="checkbox"> Share this group's Codimium browser profile and cookies. Only one group task can use the browser at a time.</label><p class="error" role="alert"></p><div class="actions"><button type="submit" class="primary">Create group</button><button type="button" data-close>Cancel</button></div></form></dialog>
<dialog id="group-members-dialog" aria-labelledby="group-members-title"><form id="group-members-form"><h2 id="group-members-title">Group members</h2><p class="muted">Choose 2 to 16 Pods. Added Pods can read existing messages and shared files. Stop or finish open group tasks before removing a Pod; membership changes keep the group's history.</p><div id="group-members-options" class="group-member-options" role="group" aria-label="Pods in this group"></div><p id="group-members-status" class="muted" role="status" aria-live="polite"></p><p class="error" role="alert"></p><div class="actions"><button id="group-members-save" type="submit" class="primary" disabled>Save members</button><button type="button" data-close>Cancel</button></div></form></dialog>
<dialog id="delete-confirm-dialog" aria-labelledby="delete-confirm-title"><form id="delete-confirm-form"><h2 id="delete-confirm-title">Confirm deletion</h2><p id="delete-confirm-description" class="muted"></p><p class="delete-confirm-instruction">Type <code id="delete-confirm-name"></code> exactly to confirm.</p><label>Confirmation name<input id="delete-confirm-input" name="confirmation" required autocomplete="off" autocapitalize="off" spellcheck="false"></label><p class="error" role="alert"></p><div class="actions"><button id="delete-confirm-submit" type="submit" class="danger">Delete permanently</button><button type="button" data-close>Cancel</button></div></form></dialog>
<section id="group-dialog" hidden aria-label="Group conversation"><header class="heading"><div class="row spread"><h2 id="group-title">Collaboration group</h2><div class="group-header-actions"><button id="group-members-edit" type="button">Members</button><button id="group-library" type="button">Library</button></div></div><p id="group-description" class="muted"></p></header><div id="group-transcript" class="group-messages" aria-live="polite"></div><h3>Shared artifacts</h3><div id="group-artifacts"></div><form id="group-message-form"><div id="group-recipients" class="group-members"></div><label>Send a group task<textarea name="message" required maxlength="100000"></textarea></label><p class="muted">Choose which teammates should reply.</p><p class="error" role="alert"></p><div class="actions"><button type="submit" class="primary">Send to selected agents</button><button type="button" id="delete-group" class="danger">Delete group</button></div></form></section>
<dialog id="reconcile-dialog"><form id="reconcile-form"><h2>Review interrupted work</h2><p class="muted">Inspect the effects on the worker host before continuing. A task may have acted before it stopped.</p><label>What did you verify?<textarea name="evidence" required maxlength="10000" placeholder="Describe the effects you observed and why continuing is safe."></textarea></label><p class="error" role="alert"></p><div class="actions"><button type="submit" class="primary">Save review</button><button type="button" data-close>Cancel</button></div></form></dialog>
<dialog id="settings-dialog" aria-labelledby="settings-title"><header class="editor-heading"><p class="eyebrow">DEEPSEEK CODE</p><h2 id="settings-title">Settings</h2><p class="muted">Provider and model changes apply to new tasks. Running tasks keep their current provider.</p></header><section class="settings-section"><h3>Provider and model</h3><p class="muted">Switch between provider profiles already configured in DeepSeek Code. Credentials stay on this machine.</p><div id="provider-settings"></div></section><section class="settings-section"><div class="row spread"><h3>DeepSeek Code settings</h3><label class="settings-scope-label">Scope<select id="settings-scope"><option value="user">User</option><option value="project">Project</option><option value="local">Local</option></select></label></div><p id="settings-scope-hint" class="muted"></p><div id="pod-settings-fields"></div></section><div class="actions"><button type="button" data-close>Done</button></div></dialog>
<dialog id="command-help-dialog" aria-labelledby="command-help-title"><h2 id="command-help-title">Slash commands</h2><p class="muted">These DeepSeek Code commands are available in Pods.</p><div id="command-help"></div><div class="actions"><button type="button" data-close>Done</button></div></dialog>
<dialog id="assign-task-dialog" aria-labelledby="assign-task-title"><header class="editor-heading"><p class="eyebrow">NEW TASK</p><h2 id="assign-task-title">Assign a task</h2><p class="muted">Pick a prompt or write your own, then review it before queueing. Each task starts a fresh conversation.</p></header><form id="assign-task-form"><label>Pod<select id="assign-task-pod" name="botId" required><option value="" disabled>Select a Pod</option></select></label><p id="assign-task-context" class="muted" role="status"></p><p id="assign-task-starter-label" class="eyebrow">Suggested starting points</p><div id="assign-task-starters" role="group" aria-label="Suggested task prompts"></div><label for="assign-task-message">Task<textarea id="assign-task-message" name="message" required maxlength="100000" placeholder="What should this Pod do? Include the result you need."></textarea></label><p class="error" role="alert"></p></form><div id="assign-task-actions" class="actions"><button type="submit" form="assign-task-form" class="primary">Queue task</button><button type="button" data-close>Cancel</button></div></dialog>
<dialog id="mobile-conversations-dialog" aria-labelledby="mobile-conversations-title"><header class="mobile-conversations-head"><div class="mobile-conversations-title-row"><div><p class="eyebrow">POD WORKSPACE</p><h2 id="mobile-conversations-title">Conversations</h2><p id="mobile-conversations-pod" class="mobile-conversations-pod"></p></div><button type="button" data-close>Close</button></div><div class="mobile-conversations-tools"><label>Search conversations<input id="mobile-conversations-search" type="search" maxlength="128" autocomplete="off" placeholder="Find a conversation"></label><button id="mobile-conversations-new" type="button" class="primary">New conversation</button></div><p id="mobile-conversations-count" role="status" aria-live="polite"></p></header><ul id="mobile-conversations-list" aria-label="Pod conversations"></ul></dialog>
<dialog id="quick-open-dialog" aria-labelledby="quick-open-title"><header class="quick-open-head"><div class="quick-open-title-row"><div><p id="quick-open-eyebrow" class="eyebrow">QUICK SWITCH</p><h2 id="quick-open-title">Jump to anything</h2></div><button id="quick-open-close" type="button">Close</button></div><input id="quick-open-search" type="search" role="combobox" aria-label="Search Pods, groups, conversations and actions" aria-autocomplete="list" aria-expanded="false" aria-controls="quick-open-results" autocomplete="off" maxlength="128" placeholder="Search Pods, groups, conversations..."></header><div id="quick-open-results" role="listbox" aria-label="Workspace results"></div><p id="quick-open-empty" hidden role="status">No matching Pods, groups, conversations or actions.</p><p id="quick-open-help" role="status" aria-live="polite">Up/Down to move | Enter to open | Esc to close</p></dialog>
<dialog id="workspace-history-dialog" aria-labelledby="workspace-history-title"><header class="quick-open-head"><p class="eyebrow">WORKSPACE SEARCH</p><h2 id="workspace-history-title">Find past work</h2><form id="workspace-history-form"><label><span>Search task prompts and results across all Pods</span><input id="workspace-history-query" name="query" type="search" minlength="2" maxlength="128" required placeholder="Try a phrase, file name or error"></label><button class="primary" type="submit">Search</button></form></header><p id="workspace-history-status" class="muted" role="status">Find finished tasks across every Pod in this workspace.</p><div id="workspace-history-results" role="region" aria-label="Task search results" aria-live="polite"></div><div id="workspace-history-actions"><button type="button" data-close>Done</button></div></dialog>
<script nonce="__NONCE__">
${POD_AVATAR_RUNTIME}
${INTELLIGENT_UI_RUNTIME}

const $ = id => document.getElementById(id);
let guideRun = null, guideKey = null, noteEdit = null, routineEdit = null;
let workspaceHistoryRequest = 0;
let folderPickerRequest = 0, folderPickerPath = '', folderPickerParent = null, folderPickerDirectories = [];
let overviewMode = true, overviewFilter = 'all', selected = null, current = null, selectedConversation = null, newConversationDraft = false, selectedGroup = null, groupMessageKey = null, botsState = [], groupsState = [], quickOpenMatches = [], quickOpenSelection = 0, workspaceConversationResults = [], quickOpenConversationRequest = 0, quickOpenConversationTimer = 0, quickOpenSearchingConversations = false, authenticated = false, refreshing = false, messageKey = null, routineKey = null, reviewRun = null, learnRun = null, eventCursor = 0, eventItems = [], browserRun = null, browserView = null, authEpoch = 0, reviewOpen = false, pendingDecisions = 0, observedDecisionBot = null, observedDecisionIds = new Set(), commandSelection = -1, providerProfiles = null, settingsFields = [], settingsLevel = 'user';
const signatures = new Map();
const drafts = new Map();
const groupDrafts = new Map();
const activeConversations = new Map();
const draftStorageKey='deepseek.pods.drafts.v1';
const createDraftStorageKey='deepseek.pods.create.v1';
let draftSaveTimer=0,draftStorageWarning=false;
let createDraftWarning=false;
function validStoredDraft(value){return Boolean(value&&typeof value.message==='string'&&value.message.trim()&&value.message.length<=100000&&(value.key===null||typeof value.key==='string'&&/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(value.key)))}
function restoreDraftState(){let count=0;try{const saved=JSON.parse(sessionStorage.getItem(draftStorageKey)||'null');if(saved?.version!==1)return 0;for(const entry of Array.isArray(saved.pods)?saved.pods:[]){if(!Array.isArray(entry)||entry.length!==2||typeof entry[0]!=='string'||!entry[0]||entry[0].length>128||!Array.isArray(entry[1]))continue;const conversations=new Map();for(const item of entry[1]){if(!Array.isArray(item)||item.length!==2||item[0]!==null&&(typeof item[0]!=='string'||item[0].length>128)||!validStoredDraft(item[1]))continue;conversations.set(item[0],{message:item[1].message,key:item[1].key});count++}if(conversations.size)drafts.set(entry[0],conversations)}for(const entry of Array.isArray(saved.groups)?saved.groups:[]){if(!Array.isArray(entry)||entry.length!==2||typeof entry[0]!=='string'||!entry[0]||entry[0].length>128||!validStoredDraft(entry[1]))continue;groupDrafts.set(entry[0],{message:entry[1].message,key:entry[1].key});count++}}catch{try{sessionStorage.removeItem(draftStorageKey)}catch{}}return count}
function persistDraftState(){if(draftSaveTimer){clearTimeout(draftSaveTimer);draftSaveTimer=0}try{if(!drafts.size&&!groupDrafts.size){sessionStorage.removeItem(draftStorageKey);return}sessionStorage.setItem(draftStorageKey,JSON.stringify({version:1,pods:[...drafts].map(([botId,items])=>[botId,[...items]]),groups:[...groupDrafts]}));draftStorageWarning=false}catch{if(authenticated&&!draftStorageWarning){draftStorageWarning=true;notify('Browser storage is unavailable. Drafts will stay only until this page closes.')}}}
function scheduleDraftPersistence(){if(draftSaveTimer)clearTimeout(draftSaveTimer);draftSaveTimer=setTimeout(persistDraftState,250)}
function discardDraftState(){if(draftSaveTimer)clearTimeout(draftSaveTimer);draftSaveTimer=0;draftStorageWarning=false;drafts.clear();groupDrafts.clear();try{sessionStorage.removeItem(draftStorageKey)}catch{}}
function discardCreateDraft(){createDraftWarning=false;try{sessionStorage.removeItem(createDraftStorageKey)}catch{};document.getElementById('create-draft-fresh')?.setAttribute('hidden','')}
let restoredDraftCount=restoreDraftState();
window.addEventListener('pagehide',persistDraftState);window.addEventListener('pagehide',persistCreateDraft);
function draftFor(botId,conversationId){return drafts.get(botId)?.get(conversationId??null)}
function saveDraft(botId,conversationId,message=$('message').value,key=messageKey){if(!botId||!authenticated)return;let podDrafts=drafts.get(botId);if(message.trim()){if(!podDrafts)drafts.set(botId,podDrafts=new Map());podDrafts.set(conversationId??null,{message,key})}else if(podDrafts){podDrafts.delete(conversationId??null);if(!podDrafts.size)drafts.delete(botId)}scheduleDraftPersistence()}
function clearDraft(botId,conversationId){saveDraft(botId,conversationId,'',null)}
function clearBotDrafts(botId){drafts.delete(botId);activeConversations.delete(botId);scheduleDraftPersistence()}
function rememberCurrentDraft(){if(selected)saveDraft(selected,selectedConversation)}
function saveGroupDraft(groupId){if(!groupId||!authenticated)return;const form=$('group-message-form'),message=form.elements.message.value,had=groupDrafts.has(groupId);if(message.trim())groupDrafts.set(groupId,{message,key:groupMessageKey});else groupDrafts.delete(groupId);scheduleDraftPersistence();if(had!==groupDrafts.has(groupId))showGroups(groupsState)}
function restoreGroupDraft(groupId){const draft=groupDrafts.get(groupId);$('group-message-form').elements.message.value=draft?.message||'';groupMessageKey=draft?.key||null}
function rememberActiveConversation(){if(selected)activeConversations.set(selected,{conversationId:selectedConversation,newConversationDraft})}
function setConversationContext(conversationId,isNew=false){selectedConversation=conversationId;newConversationDraft=isNew;if(selected)activeConversations.set(selected,{conversationId,newConversationDraft:isNew})}
function restoreDraft(botId,conversationId){const draft=draftFor(botId,conversationId);$('message').value=draft?.message||'';messageKey=draft?.key||null;renderCommandMenu();const prompts=$('starter-prompts');if(prompts.dataset.available==='true')prompts.hidden=Boolean($('message').value.trim())}
function hasConversationDraft(botId,conversationId){return Boolean(draftFor(botId,conversationId)?.message.trim())}
function clearSubmittedDraft(botId,conversationId,message){if(draftFor(botId,conversationId)?.message===message)clearDraft(botId,conversationId)}
function notifyDraftRecovery(){if(!restoredDraftCount)return;restoredDraftCount=0;const podIds=new Set(botsState.map(bot=>bot.id)),groupIds=new Set(groupsState.map(group=>group.id));let removed=false;for(const botId of drafts.keys())if(!podIds.has(botId)){drafts.delete(botId);removed=true}for(const groupId of groupDrafts.keys())if(!groupIds.has(groupId)){groupDrafts.delete(groupId);removed=true}if(removed)scheduleDraftPersistence();const count=[...drafts.values()].reduce((total,items)=>total+items.size,groupDrafts.size);if(count)notify(count+' unsent '+(count===1?'draft was':'drafts were')+' restored in this tab. Look for Draft in Pods, conversations or groups.')}
function workspaceDrafts(bots){const items=[],byId=new Map(bots.map(bot=>[bot.id,bot]));for(const [botId,conversations] of drafts){const bot=byId.get(botId);if(!bot)continue;for(const [conversationId,draft] of conversations){const preview=String(draft.message||'').replace(/\s+/g,' ').trim();if(preview)items.push({kind:'pod',id:botId,botId,conversationId,owner:bot.name,destination:conversationId===null?'New conversation':current?.bot.id===botId?current.conversations?.find(conversation=>conversation.id===conversationId)?.title||'Pod conversation':'Pod conversation',preview:preview.slice(0,140)})}}for(const [groupId,draft] of groupDrafts){const group=groupsState.find(item=>item.id===groupId),preview=String(draft.message||'').replace(/\s+/g,' ').trim();if(group&&preview)items.push({kind:'group',id:groupId,owner:group.name,destination:'Group chat',preview:preview.slice(0,140)})}return items}
function resumeWorkspaceDraft(item){if(item.kind==='group'){void selectGroup(item.id);return}selectBot(item.botId);if(item.conversationId===null)startNewConversation();else selectConversation(item.conversationId);void refresh()}
const seenActivity = new Map();
const activityByRun = new Map(), activityOpen = new Map(), runPromptOpen = new Set();
let activityVersion = 0;
function podDigest(value, max = 180){if(value === undefined || value === null)return '';const text = String(typeof value === 'string' ? value : JSON.stringify(value) ?? '').replace(/\s+/g,' ').trim();if(!text)return '';return text.length > max ? text.slice(0, max) + '…' : text}
function indexActivity(events){for(const event of events){const payload = event.payload || {};const runId = payload.runId || payload.run_id;if(!runId || (event.type !== 'BotToolCall' && event.type !== 'BotToolResult'))continue;let steps = activityByRun.get(runId);if(!steps){steps = [];activityByRun.set(runId, steps)}steps.push({type:event.type,tool:podDigest(payload.tool,64),args:podDigest(payload.args,180),result:podDigest(payload.result,2000),created_at:event.created_at});if(steps.length > 400)steps.splice(0, steps.length - 400);activityVersion++}}
function showEventList(){const container = $('activity-list');container.replaceChildren();for(const event of eventItems){const el = node('div');el.append(node('strong',event.type),node('p',date(event.created_at),'muted'));const details = node('details');details.append(node('summary','Details'),node('pre',JSON.stringify(event.payload,null,2)));el.append(details);container.append(el)}}
function renderRunActivity(run){const steps = activityByRun.get(run.id);if(!steps || !steps.length)return null;const live = run.status === 'running';const details = node('details',undefined,'live-activity');details.dataset.live = live ? 'true' : 'false';details.open = activityOpen.has(run.id) ? activityOpen.get(run.id) : live;details.addEventListener('toggle',() => {activityOpen.set(run.id,details.open)});const header = node('summary');header.append(node('span',run.status === 'running' ? 'Working' : run.status === 'waiting' || run.status === 'blocked' ? 'Waiting' : 'Work log','live-step-state'),node('span',steps.length === 1 ? '1 step' : steps.length + ' steps','muted'));details.append(header);const list = node('div',undefined,'live-steps');for(const step of steps.slice(-24)){if(step.type === 'BotToolCall'){const row = node('div',undefined,'step');row.append(node('span',step.tool || 'tool','step-name'),node('span',step.args,'step-args'));list.append(row)}else{const row = node('details',undefined,'step');const rowHeader = node('summary');rowHeader.append(node('span',step.tool || 'tool','step-name'),node('span',step.result,'step-args'));row.append(rowHeader,node('pre',step.result,'step-output'));list.append(row)}}details.append(list);return details}
try{const saved=JSON.parse(localStorage.getItem('deepseek.pods.seen.v1')||'[]');if(Array.isArray(saved))for(const pair of saved)if(Array.isArray(pair)&&typeof pair[0]==='string'&&typeof pair[1]==='string')seenActivity.set(pair[0],pair[1])}catch{}
function activityStamp(pod){const run=pod.latestRun;return run&&['completed','failed','waiting','blocked'].includes(run.status)?run.id+':'+run.status+':'+run.updatedAt:null}
function markSeen(pod){const stamp=activityStamp(pod);if(!stamp||document.hidden)return;seenActivity.set(pod.id,stamp);try{localStorage.setItem('deepseek.pods.seen.v1',JSON.stringify([...seenActivity].slice(-512)))}catch{}}
function downloadText(name,content){const url=URL.createObjectURL(new Blob([content],{type:'text/plain;charset=utf-8'}));const link=node('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
function downloadResultButton(run){return button('Download result',()=>downloadText('pod-result-'+run.id+'.txt',run.output))}
function resultCard(run){const card=node('article',undefined,'result-card');card.dataset.run=run.id;card.append(node('span','Saved result · '+date(run.updatedAt||run.createdAt),'muted'),node('h3',run.prompt.slice(0,100)));const details=node('details');details.append(node('summary','Read result'),renderPodIntelligentAnswer(run.output));card.append(details);const actions=node('div',undefined,'actions');actions.append(copyButton(run.output),downloadResultButton(run));card.append(actions);const links=[...new Set(run.output.match(/https?:\/\/[^\s<>"']+/g)||[])].slice(0,8);for(const raw of links){try{const url=new URL(raw);if(url.username||url.password)continue;const link=node('a',url.hostname);link.href=url.href;link.target='_blank';link.rel='noopener noreferrer';card.append(link)}catch{}}return card}
function showLibrary(runs){update('library-results',{runs: runs.filter(run=>run.status==='completed'&&run.output)},container=>{container.replaceChildren();for(const run of runs)if(run.status==='completed'&&run.output)container.append(resultCard(run));if(!container.childNodes.length)container.append(node('p','Completed results will be waiting here.','muted'))})}
function syncGroupWorkspace(){const group=Boolean(selectedGroup);document.querySelector('.workspace').dataset.group=String(group);$('group-dialog').hidden=!group}
document.querySelector('.workspace').append($('group-dialog'));
$('group-library').addEventListener('click',()=>{$('group-artifacts').hidden=!$('group-artifacts').hidden;$('group-library').setAttribute('aria-expanded',String(!$('group-artifacts').hidden))});
$('group-members-edit').addEventListener('click',event=>perform(event.currentTarget,openGroupMembersEditor));

let deleteConfirmName='',deleteConfirmAction=null;
const routineRunKeys = new Map();
function node(tag,text,className){const el=document.createElement(tag);if(text!==undefined)el.textContent=String(text);if(className)el.className=className;return el}
function submitter(event){return event.submitter||event.currentTarget.querySelector('button[type="submit"],button:not([type])')}
function button(text,action,className){const el=node('button',text,className);el.type='button';el.addEventListener('click',()=>perform(el,action));return el}
function renderHistorySummary(task,podName){const summary=node('div',undefined,'history-summary'),prompt=node('article',undefined,'history-summary-turn user');prompt.append(node('strong','You','history-summary-speaker'),node('p',task.prompt,'history-summary-prompt'));summary.append(prompt);if(task.output){const reply=node('article',undefined,'history-summary-turn assistant');reply.append(node('strong',podName||'Pod','history-summary-speaker'),renderPodIntelligentAnswer(task.output));summary.append(reply)}if(task.error){const error=node('article',undefined,'history-summary-error');error.append(node('strong','Reported error'),node('p',task.error));summary.append(error)}if(!task.output&&!task.error)summary.append(node('p','This task ended before a final response was saved.','muted'));return summary}
function copyButton(content,label='Copy response',success='Response copied to clipboard.'){const el=node('button',label,'primary');el.type='button';el.addEventListener('click',async()=>{el.disabled=true;try{await navigator.clipboard.writeText(content);notify(success)}catch{notify('Clipboard access is unavailable. Select the visible text and copy it manually.')}finally{el.disabled=false}});return el}
function notify(message){$('notice').textContent=message;$('notice').hidden=!message}
function openDeleteConfirmation(title,description,name,action,submitLabel='Delete permanently'){const form=$('delete-confirm-form'),input=$('delete-confirm-input');deleteConfirmName=name;deleteConfirmAction=action;form.reset();form.querySelector('.error').textContent='';$('delete-confirm-title').textContent=title;$('delete-confirm-description').textContent=description;$('delete-confirm-name').textContent=name;$('delete-confirm-submit').textContent=submitLabel;input.maxLength=Math.max(name.length,1);$('delete-confirm-dialog').showModal();input.focus()}
function setLoginTokenVisible(visible){const token=$('token'),toggle=$('token-visibility');token.type=visible?'text':'password';toggle.textContent=visible?'Hide':'Show';toggle.setAttribute('aria-label',visible?'Hide access token':'Show access token');toggle.setAttribute('aria-pressed',String(visible))}
async function api(path,data){const response=await fetch(path,{method:data===undefined?'GET':'POST',headers:data===undefined?{}:{'content-type':'application/json'},body:data===undefined?undefined:JSON.stringify(data),credentials:'same-origin'});const value=await response.json();if(!response.ok){if(response.status===401){signOut();discardDraftState()}throw new Error(value.error||'Request failed')}return value}
async function perform(control,action){control.disabled=true;try{await action();notify('');await refresh()}catch(error){notify(error.message)}finally{control.disabled=false;if(control.closest('#browser-dialog'))syncBrowserControls()}}
function update(id,value,render){const signature=JSON.stringify(value);if(signatures.get(id)===signature)return;signatures.set(id,signature);render($(id))}
function date(value){return new Date(value).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}
function runStatusLabel(status){const labels={queued:'Queued',running:'Working',waiting:'Needs you',blocked:'Review needed',completed:'Completed',failed:'Could not finish',cancelled:'Stopped'};return Object.hasOwn(labels,status)?labels[status]:status}
function syncMobileConversationTrigger(conversations=current?.conversations||[]){
  const trigger=$('mobile-conversation-trigger'),available=conversations.length+(selected&&(newConversationDraft||hasConversationDraft(selected,null))?1:0),active=conversations.find(conversation=>conversation.id===selectedConversation),title=newConversationDraft?'New conversation':selectedConversation===null&&hasConversationDraft(selected,null)?'New conversation draft':active?.title||'No conversations yet';
  trigger.hidden=!selected||Boolean(selectedGroup)||overviewMode||mobilePodsPage;$('mobile-conversation-title').textContent=title;$('mobile-conversation-count').textContent=String(available);trigger.setAttribute('aria-label','Switch conversations in '+(current?.bot.name||$('bot-name').textContent)+'. Current: '+title+'. '+available+' available.');$('mobile-new-conversation').hidden=trigger.hidden;
  if($('mobile-conversations-dialog').open){$('mobile-conversations-pod').textContent=current?.bot.name||$('bot-name').textContent;renderMobileConversationPicker(conversations)}
}
function renderMobileConversationPicker(conversations=current?.conversations||[]){
  const query=$('mobile-conversations-search').value.trim().toLowerCase(),hasDraft=Boolean(selected&&(newConversationDraft||hasConversationDraft(selected,null))),matches=conversations.filter(conversation=>conversation.title.toLowerCase().includes(query)),showDraft=hasDraft&&(!query||'new conversation draft'.includes(query)),total=conversations.length+(hasDraft?1:0),shown=matches.length+(showDraft?1:0);
  $('mobile-conversations-pod').textContent=current?.bot.name||$('bot-name').textContent;$('mobile-conversations-count').textContent=query?shown+' of '+total+' conversations':total+' '+(total===1?'conversation':'conversations');
  update('mobile-conversations-list',{selected,selectedConversation,newConversationDraft,query,conversations:matches.map(conversation=>[conversation.id,conversation.title,conversation.updatedAt,conversation.deleting,hasConversationDraft(selected,conversation.id)]),showDraft},container=>{
    container.replaceChildren();
    if(!shown){const empty=node('li',undefined,'mobile-conversation-empty');empty.append(node('strong',total?'No conversations match':'No conversations yet'),node('span',total?'Try a different title.':'Start a conversation to keep new task work separate from other conversations.'));if(total)empty.append(button('Clear search',()=>{$('mobile-conversations-search').value='';renderMobileConversationPicker(conversations)}));container.append(empty);return}
    if(showDraft){const item=button('',()=>{ $('mobile-conversations-dialog').close();startNewConversation() },'mobile-conversation-option'),copy=node('span',undefined,'mobile-conversation-copy'),title=node('strong',undefined,'mobile-conversation-title');title.append(node('span','New conversation'));if(newConversationDraft)title.append(node('span','Current','mobile-conversation-current-badge'));copy.append(title,node('span','Unsent task draft','mobile-conversation-time'));item.setAttribute('aria-current',String(newConversationDraft));item.append(copy,node('span','Draft','conversation-draft'));container.append(item)}
    for(const conversation of matches){const item=button('',()=>{ $('mobile-conversations-dialog').close();selectConversation(conversation.id) },'mobile-conversation-option'),copy=node('span',undefined,'mobile-conversation-copy'),title=node('strong',undefined,'mobile-conversation-title'),isCurrent=!newConversationDraft&&conversation.id===selectedConversation,hasDraft=hasConversationDraft(selected,conversation.id);title.append(node('span',conversation.title));if(isCurrent)title.append(node('span','Current','mobile-conversation-current-badge'));if(hasDraft)title.append(node('span','Draft','conversation-draft'));copy.append(title,node('span',conversation.deleting?'Deletion in progress':date(conversation.updatedAt),'mobile-conversation-time'));item.disabled=conversation.deleting===true;item.setAttribute('aria-current',String(isCurrent));item.append(copy);container.append(item)}
  });
}
function openMobileConversationPicker(){const dialog=$('mobile-conversations-dialog');if($('app').hidden||!selected||selectedGroup||overviewMode||mobilePodsPage||dialog.open||document.querySelector('dialog:modal'))return;$('mobile-conversations-search').value='';renderMobileConversationPicker();dialog.showModal()}
function showConversations(conversations=current?.conversations||[]){
  syncMobileConversationTrigger(conversations);
  const draftState=conversations.map(conversation=>[conversation.id,hasConversationDraft(selected,conversation.id)]);
  update('conversations',{conversations,selected,selectedConversation,draftState},container=>{
    container.replaceChildren();
    if(!selected){container.append(node('p','Choose a Pod to see its conversations.','muted'));return}
    if(!conversations.length){container.append(node('p','No conversations yet.','muted'));return}
    for(const conversation of conversations){
      const row=node('div',undefined,'conversation-row'),item=node('button','','conversation-item'),title=node('strong',undefined,'conversation-title');
      item.type='button';item.disabled=conversation.deleting===true;item.setAttribute('aria-current',String(conversation.id===selectedConversation));item.title=conversation.title;
      title.append(node('span',conversation.title,'conversation-title-text'));
      if(hasConversationDraft(selected,conversation.id))title.append(node('span','Draft','conversation-draft'));
      item.append(title,node('time',conversation.deleting?'Deletion in progress':date(conversation.updatedAt),'muted'));
      item.addEventListener('click',()=>selectConversation(conversation.id));row.append(item);
      const remove=node('button',conversation.deleting?'↻':'×','conversation-delete');
      remove.type='button';remove.title=conversation.deleting?'Resume conversation deletion':'Delete conversation';remove.setAttribute('aria-label',(conversation.deleting?'Resume deletion of ':'Delete ')+conversation.title);
      remove.addEventListener('click',()=>{
        const botId=selected,resume=conversation.deleting;
        openDeleteConfirmation(resume?'Resume conversation deletion':'Delete conversation',resume?'Finish deleting this conversation and its saved task history. Learned browser skills stay available.':'This permanently deletes this conversation and its saved task history. Learned browser skills stay available.',conversation.title,async()=>{
          const wasSelected=selectedConversation===conversation.id;
          await api('/api/bots/'+encodeURIComponent(botId)+'/conversations/'+encodeURIComponent(conversation.id)+'/delete',{confirmation:conversation.title});
          clearDraft(botId,conversation.id);
          if(wasSelected){setConversationContext(null,true);restoreDraft(botId,null);signatures.delete('feed')}
        },resume?'Resume deletion':'Delete permanently')
      });
      row.append(remove);container.append(row)
    }
  })
}
function selectConversation(id){
  rememberCurrentDraft();setConversationContext(id,false);restoreDraft(selected,id);signatures.delete('feed');showConversations();
  if(current)showRuns(current.runs.filter(run=>run.conversationId===id),current.unreconciledRuns,current.guidance,null);
  setReviewOpen(false)
}
function startNewConversation(preserveCurrent=true){
  if(!selected)return;
  if(preserveCurrent)rememberCurrentDraft();else clearDraft(selected,selectedConversation);
  setConversationContext(null,true);restoreDraft(selected,null);setReviewOpen(false);signatures.delete('feed');showConversations();
  if(current)showRuns([],current.unreconciledRuns,current.guidance,null);
  $('message').focus()
}
async function loadProviderProfiles(){providerProfiles=await api('/api/settings/provider-profiles');renderProviderSettings()}
function renderProviderSettings(){
  const container=$('provider-settings');container.replaceChildren();
  if(!providerProfiles){container.append(node('p','Loading provider profiles…','muted'));return}
  if(!providerProfiles.profiles.length){container.append(node('p','No provider profiles are configured. Add one in DeepSeek Code TUI, then choose it here.','muted'));return}
  const controls=node('div',undefined,'provider-controls'),profileLabel=node('label','Provider profile'),select=document.createElement('select');select.id='provider-profile-select';
  for(const profile of providerProfiles.profiles){const option=node('option',profile.name+' · '+profile.provider+' · '+(profile.model||'provider default'));option.value=profile.id;option.selected=profile.id===providerProfiles.activeProfileId;select.append(option)}
  profileLabel.append(select);
  const currentProfile=()=>providerProfiles.profiles.find(item=>item.id===select.value);
  const use=button('Use for new tasks',async()=>{const profile=currentProfile();if(!profile)throw new Error('Choose a provider profile');await api('/api/settings/provider-profiles/active',{profileId:profile.id});await loadProviderProfiles()});
  const modelLabel=node('label','Model for this profile');modelLabel.className='provider-model';const model=document.createElement('input');model.id='provider-model-input';model.maxLength=128;model.pattern='[A-Za-z0-9][A-Za-z0-9._:/\\-]{0,127}';model.placeholder='Use the provider default';
  const status=node('p',undefined,'settings-profile-state');
  function syncProfile(){const profile=currentProfile();model.value=profile?.model||'';status.textContent=!profile?.ready?'Not ready — finish configuring this profile in DeepSeek Code TUI.':profile.id===providerProfiles.activeProfileId?'Active for new tasks. Credentials stay private.':'Ready to use. Credentials stay private.';use.textContent=profile?.id===providerProfiles.activeProfileId?'Active for new tasks':'Use for new tasks';use.disabled=!profile?.ready||profile.id===providerProfiles.activeProfileId}
  select.addEventListener('change',syncProfile);syncProfile();modelLabel.append(model);
  const actions=node('div',undefined,'actions');actions.append(use,button('Save model',async()=>{const profile=currentProfile();if(!profile)throw new Error('Choose a provider profile');await api('/api/settings/provider-profiles/'+encodeURIComponent(profile.id)+'/model',{model:model.value.trim()});await loadProviderProfiles()}));
  controls.append(profileLabel,modelLabel,status,actions);container.append(controls)
}
function renderSettingsFields(fields=settingsFields){const container=$('pod-settings-fields');container.replaceChildren();const groups=new Map();for(const field of fields){if(!groups.has(field.category)){const group=node('section',undefined,'settings-group');group.append(node('h4',field.category));groups.set(field.category,group);container.append(group)}const row=node('div',undefined,'setting-row'),fieldId='setting-'+field.path.replace(/[^a-z0-9]+/gi,'-'),label=node('label',field.label);label.htmlFor=fieldId;label.append(node('span',field.description));const value=field.value===undefined?field.effective:field.value;let control;if(field.kind==='boolean'){control=document.createElement('input');control.type='checkbox';control.checked=value===true}else if(field.kind==='select'){control=document.createElement('select');for(const optionValue of field.options){const option=node('option',optionValue);option.value=optionValue;option.selected=optionValue===value;control.append(option)}}else{control=document.createElement('input');control.type=field.kind==='number'?'number':'text';control.value=value===undefined?'':String(value);if(field.kind==='number'){control.min=String(field.min);control.max=String(field.max);if(field.step)control.step=String(field.step)}else{control.maxLength=128;control.pattern='[A-Za-z0-9][A-Za-z0-9._:/\\-]{0,127}'}}control.id=fieldId;const editor=node('div',undefined,'setting-control');editor.append(control);const actions=node('div',undefined,'setting-actions');actions.append(button('Save',async()=>{let nextValue=control.type==='checkbox'?control.checked:control.type==='number'?Number(control.value):control.value;if(control.type==='number'&&!control.value.trim())throw new Error(field.label+' needs a number');const response=await api('/api/bots/'+encodeURIComponent(selected)+'/settings?level='+settingsLevel,{level:settingsLevel,path:field.path,value:nextValue});settingsFields=response.fields;renderSettingsFields()} ,'primary'));if(field.value!==undefined)actions.append(button('Reset',async()=>{const response=await api('/api/bots/'+encodeURIComponent(selected)+'/settings?level='+settingsLevel,{level:settingsLevel,path:field.path,reset:true});settingsFields=response.fields;renderSettingsFields()}));row.append(label,editor,node('span','Effective: '+String(field.effective??'default')+' · '+field.origin,'setting-origin'),actions);groups.get(field.category).append(row)}}
async function loadPodSettings(level=settingsLevel){settingsLevel=level;$('settings-scope').value=level;$('settings-scope-hint').textContent=level==='user'?'User settings affect every project.':'These settings affect the selected Pod project.';$('pod-settings-fields').replaceChildren(node('p','Loading settings…','muted'));try{const response=await api('/api/bots/'+encodeURIComponent(selected)+'/settings?level='+level);settingsFields=response.fields;renderSettingsFields()}catch(error){settingsFields=[];$('pod-settings-fields').replaceChildren(node('p',error.message,'error'));throw error}}
async function openSettings(focusProvider=false){if(!selected)return;$('settings-dialog').showModal();providerProfiles=null;settingsFields=[];renderProviderSettings();$('pod-settings-fields').replaceChildren(node('p','Loading settings…','muted'));try{await Promise.all([loadProviderProfiles(),loadPodSettings('user')]);if(focusProvider)$('provider-profile-select')?.focus()}catch(error){notify(error.message)}}
function commandDescription(command){if(command==='/new'||command==='/clear')return 'Open a blank draft; save it after the first message';if(command==='/sessions')return 'Show this Pod’s conversations';return COMMAND_DESCRIPTIONS[command]||'Run a DeepSeek Code command'}
function openCommandHelp(){const container=$('command-help');container.replaceChildren();for(const command of POD_COMMANDS)container.append(node('code',command),node('span',commandDescription(command)));$('command-help-dialog').showModal()}
function renderCommandMenu(){const raw=$('message').value.trimStart(),menu=$('command-menu');commandSelection=-1;menu.replaceChildren();if(!raw.startsWith('/')||/\s/.test(raw)){menu.hidden=true;$('message').setAttribute('aria-expanded','false');$('message').removeAttribute('aria-activedescendant');return}const matches=POD_COMMANDS.filter(command=>command.startsWith(raw.toLowerCase()));if(!matches.length){menu.hidden=true;$('message').setAttribute('aria-expanded','false');$('message').removeAttribute('aria-activedescendant');return}for(const [index,command] of matches.entries()){const option=node('button','', 'command-option');option.type='button';option.id='command-option-'+index;option.setAttribute('role','option');option.setAttribute('aria-selected','false');option.append(node('code',command),node('span',commandDescription(command)));option.addEventListener('click',()=>acceptCommand(command));menu.append(option)}menu.hidden=false;$('message').setAttribute('aria-expanded','true')}
function acceptCommand(command){
  const message=$('message');message.value=command+' ';messageKey=null;commandSelection=-1;$('command-menu').hidden=true;message.setAttribute('aria-expanded','false');message.removeAttribute('aria-activedescendant');
  if(selected){saveDraft(selected,selectedConversation,message.value,null);showConversations()}
  message.focus();message.setSelectionRange(message.value.length,message.value.length)
}
function moveCommandSelection(direction){const options=[...$('command-menu').querySelectorAll('[role="option"]')];if(!options.length)return false;commandSelection=(commandSelection+direction+options.length)%options.length;for(const [index,option] of options.entries())option.setAttribute('aria-selected',String(index===commandSelection));$('message').setAttribute('aria-activedescendant',options[commandSelection].id);options[commandSelection].scrollIntoView({block:'nearest'});return true}
async function queueConversationTask(botId,message,newConversation=false,occurrenceId=crypto.randomUUID()){
  if(selected===botId)rememberCurrentDraft();
  const conversationId=botId===selected&&!newConversation?selectedConversation:null,input={message,occurrenceId,...(conversationId?{conversationId}:{})},queued=await api('/api/bots/'+encodeURIComponent(botId)+'/messages',input);
  if(selected===botId)setConversationContext(queued.conversationId,false);
  return queued.conversationId
}
async function runSlashCommand(raw,occurrenceId){const input=raw.trim();if(/^\/new(?:\s|$)/i.test(input)||/^\/clear$/i.test(input)){startNewConversation(false);return true}const parsed=parseCommand(input);if(!parsed)return false;if(parsed.type==='unknown'){notify(parsed.input);return true}const botId=selected;if(!botId)throw new Error('Choose a Pod first');if(parsed.type==='help'){openCommandHelp();return true}if(parsed.type==='config'){openSettings();return true}if(parsed.type==='models'){openSettings(true);return true}if(parsed.type==='model'){const profiles=await api('/api/settings/provider-profiles');if(profiles.activeProfileId)await api('/api/settings/provider-profiles/'+encodeURIComponent(profiles.activeProfileId)+'/model',{model:parsed.model});else await api('/api/bots/'+encodeURIComponent(botId)+'/settings?level=user',{level:'user',path:'model.default',value:parsed.model});if($('settings-dialog').open)await loadProviderProfiles();return true}if(parsed.type==='plan'){await queueConversationTask(botId,'Create a read-only implementation plan for this task. Explore the project as needed, but do not edit files or make changes. Return the plan and assumptions only.\n\nTask: '+parsed.task,false,occurrenceId);return true}if(parsed.type==='review'){await queueConversationTask(botId,REVIEW_PROMPT(parsed.target),false,occurrenceId);return true}if(parsed.type==='verify'){await queueConversationTask(botId,'Identify the project\'s documented verification command, run it, and report the exact command and results. Do not edit project files. If the command is unclear or would cause consequential changes, ask before proceeding.',false,occurrenceId);return true}if(parsed.type==='retry'){const run=current?.runs.find(item=>item.conversationId===selectedConversation&&['failed','blocked'].includes(item.status)&&item.owner===null);if(!run)throw new Error('This conversation has no failed or blocked task to retry');await api('/api/runs/'+encodeURIComponent(run.id)+'/retry',{reconciled:run.status==='blocked'});return true}if(parsed.type==='sessions'&&!('action' in parsed)){document.querySelector('.conversation-heading').scrollIntoView({behavior:'smooth',block:'nearest'});$('conversations').focus();return true}if(parsed.type==='steer'){if(!parsed.instruction.trim())throw new Error('Usage: /steer <instruction>');const run=current?.runs.find(item=>item.conversationId===selectedConversation&&['running','waiting'].includes(item.status)&&item.acceptingMessages);if(!run)throw new Error('There is no active task in this conversation to steer');await api('/api/runs/'+encodeURIComponent(run.id)+'/messages',{message:parsed.instruction,messageId:crypto.randomUUID()});return true}if(parsed.type==='sessions'&&'action' in parsed)throw new Error('Session export is available in DeepSeek Code TUI, not Pods yet');throw new Error('This DeepSeek Code command is not available in Pods yet. Type / to see the supported commands.')}
async function submitComposer(event){
  event.preventDefault();const id=selected,message=$('message').value,sourceConversation=selectedConversation,control=submitter(event),startsNewConversation=/^\/new(?:\s|$)|^\/clear$/i.test(message.trim());
  if(!message.trim())return;messageKey??=crypto.randomUUID();saveDraft(id,sourceConversation,message,messageKey);control.disabled=true;
  try{
    const handled=message.trimStart().startsWith('/')?await runSlashCommand(message,messageKey):false;
    if(!handled)await queueConversationTask(id,message,false,messageKey);
    if(selected===id){
      const sourceDraft=draftFor(id,sourceConversation);
      if(!startsNewConversation&&selectedConversation!==sourceConversation&&sourceDraft&&sourceDraft.message!==message){saveDraft(id,selectedConversation,sourceDraft.message,sourceDraft.key);clearDraft(id,sourceConversation)}
      else clearSubmittedDraft(id,sourceConversation,message);
      if(!startsNewConversation&&$('message').value===message){$('message').value='';messageKey=null}
      rememberCurrentDraft();renderCommandMenu();showConversations()
    }else clearSubmittedDraft(id,sourceConversation,message);
    notify('');await refresh()
  }catch(error){notify(error.message)}finally{control.disabled=false}
}
function closeDialogs(){if(selectedGroup)saveGroupDraft(selectedGroup);for(const dialog of document.querySelectorAll('dialog[open]'))dialog.close();browserRun=null;browserView=null;selectedGroup=null;syncGroupWorkspace();groupMessageKey=null;$('browser-image').removeAttribute('src');$('browser-image').hidden=true;$('browser-input').value='';reviewRun=null;learnRun=null;routineKey=null;routineEdit=null;guideRun=null;guideKey=null;noteEdit=null}
function signOut(){authEpoch++;workspaceHistoryRequest++;authenticated=false;discardCreateDraft();mobilePodsPage=false;mobileGroupRuns=[];clearTimeout(mobileChatSearchTimer);mobileChatSearchRequest++;mobileChatSearchLoading=false;mobileChatSearchError='';mobileChatSearchHasMore=false;mobileChatResults=[];overviewMode=true;selected=null;selectedConversation=null;newConversationDraft=false;current=null;botsState=[];groupsState=[];quickOpenMatches=[];closeDialogs();signatures.clear();drafts.clear();groupDrafts.clear();activeConversations.clear();routineRunKeys.clear();messageKey=null;eventItems=[];eventCursor=0;for(const form of document.querySelectorAll('form'))form.reset();setLoginTokenVisible(false);$('pod-search').value='';setReviewOpen(false);for(const id of ['bots','group-list','feed','decisions','routines','notes','procedures','activity-list','deliveries','group-transcript','group-artifacts','mobile-pods-list','group-recipients','group-create-members','group-members-options','history-results','workspace-history-results','library-results','appearance-preview','create-avatar-preview'])$(id).replaceChildren();$('workspace-history-status').textContent='Find finished tasks across every Pod in this workspace.';$('bot-name').textContent='';$('responsibility').textContent='';$('project-context').hidden=true;$('project-root-path').textContent='';$('app').hidden=true;$('login').hidden=false}
function podOverviewState(bot){if(bot.unreconciledRuns?.length)return'reconcile';if(bot.activeStatus)return bot.activeStatus;return bot.latestRun?.status==='failed'?'failed':!bot.enabled?'paused':bot.latestRun?.status||'ready'}
function overviewAttentionFor(bots,runs=[]){
  const byGroup=new Map();
  for(const run of runs){if(!run.groupId||!['waiting','blocked'].includes(run.status))continue;const group=groupsState.find(item=>item.id===run.groupId);if(!group)continue;const entry=byGroup.get(group.id)||{group,runs:[]};entry.runs.push(run);byGroup.set(group.id,entry)}
  const groupRunIds=new Set([...byGroup.values()].flatMap(entry=>entry.runs.map(run=>run.runId))),priority={reconcile:0,waiting:1,blocked:2,failed:3};
  const pods=bots.filter(bot=>['waiting','blocked','failed','reconcile'].includes(podOverviewState(bot))&&!groupRunIds.has(bot.latestRun?.id)).sort((a,b)=>priority[podOverviewState(a)]-priority[podOverviewState(b)]);
  const groups=[...byGroup.values()].sort((a,b)=>Math.min(...a.runs.map(run=>run.status==='waiting'?0:1))-Math.min(...b.runs.map(run=>run.status==='waiting'?0:1)));
  return {pods,groups,count:pods.length+groups.length}
}
function mobilePodCardDetail(bot,state){const role=String(bot.instructions||'').replace(/\s+/g,' ').trim(),active=['queued','running','waiting','blocked','failed','reconcile'].includes(state),prompt=active?String(bot.latestRun?.prompt||'').replace(/\s+/g,' ').trim():'';if(!prompt)return role||'No responsibility set';const excerpt=prompt.slice(0,100).replace(/[\uD800-\uDBFF]$/,'');return 'Current task · '+excerpt+(prompt.length>100?'…':'')}
function projectLabel(projectRoot){const path=String(projectRoot||''),segments=path.split(/[\\/]+/).filter(Boolean);return segments[segments.length-1]||path}
let mobilePodsPage = false;
let mobilePodsView = 'pods';
let mobileGroupRuns = [];
let mobileChatSearchTimer=0,mobileChatSearchRequest=0,mobileChatSearchLoading=false,mobileChatSearchError='',mobileChatSearchHasMore=false,mobileChatResults=[];

function selectMobilePodsFilter(value){document.querySelectorAll('#mobile-pods-filters [data-pods-filter]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.podsFilter===value)))}
function selectMobileWorkspaceView(value){
  const next=value==='groups'?'groups':value==='chats'?'chats':'pods';
  if(next===mobilePodsView)return;
  clearTimeout(mobileChatSearchTimer);mobileChatSearchRequest++;mobileChatSearchLoading=false;mobileChatSearchError='';mobileChatSearchHasMore=false;mobileChatResults=[];
  mobilePodsView=next;$('mobile-pods-search').value='';
  document.querySelectorAll('#mobile-workspace-switch [data-mobile-workspace-view]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.mobileWorkspaceView===next)));
  const groups=next==='groups',chats=next==='chats',tools=document.querySelector('.mobile-pods-tools'),filters=$('mobile-pods-filters');$('mobile-workspace-switch').hidden=chats;filters.hidden=chats;filters.dataset.view=groups?'groups':'pods';filters.setAttribute('aria-label',groups?'Filter groups by activity':'Filter Pods by status');filters.querySelector('[data-pods-filter="all"] span:first-child').textContent=groups?'All groups':'All Pods';tools.dataset.view=next;
  $('mobile-pods-title').textContent=groups?'Group chats':chats?'Conversations':'Your Pods';$('mobile-pods-eyebrow').textContent=groups?'WORKSPACE / GROUPS':chats?'WORKSPACE / CHATS':'WORKSPACE / PODS';$('mobile-pods-intro').textContent=groups?'Open a shared conversation or bring Pods together.':chats?'Pick up a recent conversation, search every Pod or start a task.':'Pick a Pod or open a group chat.';
  $('mobile-pods-search').setAttribute('aria-label',groups?'Search groups by name or Pod':chats?'Search conversation titles or Pod names':'Search Pods by name, role or folder');$('mobile-pods-search').placeholder=groups?'Search groups':chats?'Search conversations':'Search Pods';
  $('mobile-pods-create').textContent=chats?'New task':groups?'Create group':'New Pod';$('mobile-pods-create').setAttribute('aria-label',chats?'Start a task in a new conversation':groups?'Create a group':'Create a Pod');
  if(!chats)selectMobilePodsFilter('all');
  syncMobileTabs();
  if(chats)searchMobileChats();else renderMobilePodsPage()
}
function searchMobileChats(){
  clearTimeout(mobileChatSearchTimer);const query=$('mobile-pods-search').value.trim(),request=++mobileChatSearchRequest;mobileChatResults=[];mobileChatSearchHasMore=false;mobileChatSearchError='';mobileChatSearchLoading=true;renderMobilePodsPage();
  const load=async()=>{try{const result=await api('/api/conversations?'+(query?'query='+encodeURIComponent(query):'recent=1'));if(request!==mobileChatSearchRequest||!mobilePodsPage||mobilePodsView!=='chats'||$('mobile-pods-search').value.trim()!==query)return;mobileChatResults=result.conversations;mobileChatSearchHasMore=result.hasMore}catch(error){if(request!==mobileChatSearchRequest||!mobilePodsPage||mobilePodsView!=='chats')return;mobileChatSearchError=error.message}finally{if(request===mobileChatSearchRequest){mobileChatSearchLoading=false;if(mobilePodsPage&&mobilePodsView==='chats')renderMobilePodsPage()}}};
  if(query)mobileChatSearchTimer=window.setTimeout(()=>void load(),160);else void load()
}
function renderMobileChats(container,query,bots){
  const count=String(mobileChatResults.length)+(mobileChatSearchHasMore?'+':'');$('mobile-pods-list').setAttribute('aria-label','Conversations');
  $('mobile-pods-count').textContent=mobileChatSearchLoading?(query?'Searching conversations…':'Loading recent conversations…'):mobileChatSearchError?mobileChatSearchError:count+(query?' matching conversations':' recent conversations');
  update('mobile-pods-list',{view:'chats',query,loading:mobileChatSearchLoading,error:mobileChatSearchError,hasMore:mobileChatSearchHasMore,conversations:mobileChatResults.map(conversation=>[conversation.id,conversation.botId,conversation.title,conversation.botName,conversation.updatedAt,hasConversationDraft(conversation.botId,conversation.id)])},container=>{
    container.replaceChildren();
    if(mobileChatSearchLoading){container.append(node('li',query?'Searching your Pods…':'Loading recent conversations…','mobile-pods-empty'));return}
    if(mobileChatSearchError){const empty=node('li',undefined,'mobile-pods-empty');empty.append(node('p','CONVERSATIONS','eyebrow'),node('h2',query?'Could not search conversations':'Could not load conversations'),node('p',mobileChatSearchError),button('Try again',searchMobileChats,'primary'));container.append(empty);return}
    if(!mobileChatResults.length){const empty=node('li',undefined,'mobile-pods-empty');empty.append(node('p',query?'CHAT SEARCH':'WORKSPACE CHATS','eyebrow'),node('h2',query?'No conversations match':'No conversations yet'),node('p',query?'Try another title or Pod name.':'Start a task from any Pod and its conversation will appear here.'));empty.append(query?button('Clear search',()=>{$('mobile-pods-search').value='';searchMobileChats()}):button('Browse Pods',()=>selectMobileWorkspaceView('pods'),'primary'));container.append(empty);return}
    for(const conversation of mobileChatResults){const bot=bots.find(item=>item.id===conversation.botId)||{name:conversation.botName},draft=hasConversationDraft(conversation.botId,conversation.id),item=node('li',undefined,'mobile-pod-item'),open=node('button','','mobile-conversation-option'),copy=node('span',undefined,'mobile-conversation-copy'),title=node('strong',undefined,'mobile-conversation-title'),isCurrent=!overviewMode&&!selectedGroup&&selected===conversation.botId&&selectedConversation===conversation.id;open.type='button';open.setAttribute('aria-current',String(isCurrent));open.setAttribute('aria-label','Open '+conversation.title+' in '+conversation.botName+(draft?', unsent task draft':''));title.append(node('span',conversation.title));if(draft)title.append(node('span','Draft','conversation-draft'));copy.append(title,node('span',conversation.botName+' · '+date(conversation.updatedAt),'mobile-conversation-time'));open.append(copy,node('span','Open','mobile-chat-action'));open.addEventListener('click',()=>{mobilePodsPage=false;selectBot(conversation.botId);selectConversation(conversation.id);void refresh()});item.append(open);container.append(item)}
    if(mobileChatSearchHasMore)container.append(node('li',query?'Showing the 50 most recent matches. Add more search terms to narrow the list.':'Showing the 50 most recent conversations. Search by title or Pod to find older ones.','mobile-chat-more'))
  })
}
function syncMobileTabs(){
  const isChats=mobilePodsPage&&mobilePodsView==='chats',isOverview=overviewMode&&!mobilePodsPage&&!selectedGroup,isPods=!isChats&&(mobilePodsPage||Boolean(selectedGroup)||(!overviewMode&&!selectedGroup)),attention=overviewAttentionFor(botsState,mobileGroupRuns).count,badge=$('mobile-attention-count'),overviewTab=$('mobile-overview-tab'),attentionLabel=attention===1?'1 item needs attention':attention+' items need attention';
  overviewTab.setAttribute('aria-current',isOverview?'page':'false');overviewTab.setAttribute('aria-label',attention?'Overview, '+attentionLabel:'Overview');badge.textContent=attention>9?'9+':String(attention);badge.hidden=!attention;
  $('mobile-pods-tab').setAttribute('aria-current',isPods?'page':'false');$('mobile-chats-tab').setAttribute('aria-current',isChats?'page':'false');$('mobile-pods-page').hidden=!mobilePodsPage;document.querySelector('.workspace').dataset.podsPage=String(mobilePodsPage)
}
function renderMobilePodsPage(bots=botsState){
  const query=$('mobile-pods-search').value.trim().toLowerCase();
  $('mobile-roster-pod-count').textContent=String(bots.length);$('mobile-roster-group-count').textContent=String(groupsState.length);
  if(mobilePodsView==='chats'){renderMobileChats($('mobile-pods-list'),query,bots);return}
  if(mobilePodsView==='groups'){
    const statusFilter=document.querySelector('#mobile-pods-filters [aria-pressed="true"]')?.dataset.podsFilter||'all',matchingGroups=groupsState.filter(group=>[group.name,...group.members.map(member=>member.name)].join(' ').toLowerCase().includes(query)),activityByGroup=new Map();
    for(const run of mobileGroupRuns){if(!run.groupId)continue;const activity=activityByGroup.get(run.groupId)||{runs:[],needsAttention:false,working:false};activity.runs.push(run);if(['waiting','blocked'].includes(run.status))activity.needsAttention=true;if(['queued','running'].includes(run.status))activity.working=true;activityByGroup.set(run.groupId,activity)}
    const needsAttention=group=>Boolean(activityByGroup.get(group.id)?.needsAttention),isWorking=group=>Boolean(activityByGroup.get(group.id)?.working),filterCounts={all:matchingGroups.length,attention:matchingGroups.filter(needsAttention).length,working:matchingGroups.filter(isWorking).length,paused:0},groups=matchingGroups.filter(group=>statusFilter==='all'||statusFilter==='attention'&&needsAttention(group)||statusFilter==='working'&&isWorking(group)),total=groupsState.length+' '+(groupsState.length===1?'group':'groups'),countText=query||statusFilter!=='all'?groups.length+' of '+total:total;
    document.querySelectorAll('#mobile-pods-filters [data-pods-filter]').forEach(button=>{button.setAttribute('aria-pressed',String(button.dataset.podsFilter===statusFilter));button.querySelector('.mobile-pods-filter-count').textContent=String(filterCounts[button.dataset.podsFilter]??0)});
    if($('mobile-pods-count').textContent!==countText)$('mobile-pods-count').textContent=countText;$('mobile-pods-list').setAttribute('aria-label','Group chats');
      update('mobile-pods-list',{view:'groups',query,statusFilter,drafts:[...groupDrafts.keys()].sort(),activeRuns:mobileGroupRuns.filter(run=>groups.some(group=>group.id===run.groupId)).map(run=>[run.runId,run.status,run.promptExcerpt]),groups:groups.map(group=>[group.id,group.name,group.members.map(member=>[member.name,member.enabled])])},container=>{
      container.replaceChildren();
      if(!groups.length){const empty=node('li',undefined,'mobile-pods-empty'),filtered=Boolean(query)||statusFilter!=='all',title=query?'No groups match':statusFilter==='attention'?'No groups need attention':statusFilter==='working'?'No groups are working':'No groups yet',detail=filtered?query?'Try another group name or clear the filters.':'Change the activity filter or show all groups.':'Bring two or more Pods together in one shared conversation.',clearFilters=()=>{$('mobile-pods-search').value='';selectMobilePodsFilter('all');renderMobilePodsPage()};empty.append(node('p',filtered?'GROUP FILTER':'GROUP CHATS','eyebrow'),node('h2',title),node('p',detail));empty.append(button(filtered?'Show all groups':'Create a group',filtered?clearFilters:()=>openCreateGroup(),filtered?'':'primary'));container.append(empty);return}
      for(const group of groups){
        const groupRuns=activityByGroup.get(group.id)?.runs||[],groupRun=groupRuns[0],taskPreview=String(groupRun?.promptExcerpt||'').replace(/\s+/g,' ').trim(),hasDraft=groupDrafts.has(group.id),activeTasks=groupRuns.filter(run=>['queued','running'].includes(run.status)).length,waitingTasks=groupRuns.filter(run=>run.status==='waiting').length,blockedTasks=groupRuns.filter(run=>run.status==='blocked').length,enabledMembers=group.members.filter(member=>member.enabled).length,pausedMembers=group.members.length-enabledMembers,item=node('li',undefined,'mobile-pod-item'),card=node('div',undefined,'mobile-group-card'),open=button('',()=>selectGroup(group.id),'mobile-group-open'),task=button('',()=>startGroupTask(group.id),'mobile-pod-task'),faces=node('span',undefined,'mobile-group-avatars'),copy=node('span',undefined,'mobile-group-copy'),meta=node('span',undefined,'mobile-group-meta'),taskLabels={waiting:'Needs input · ',blocked:'Review needed · ',running:'Working · ',queued:'Queued · '},taskLabel=taskLabels[groupRun?.status]||'',taskActionLabel=hasDraft?'Resume':'New task';
        open.setAttribute('aria-label','Open '+group.name+', group chat with '+group.members.length+' Pods, '+enabledMembers+' enabled'+(pausedMembers?', '+pausedMembers+' paused':'')+(waitingTasks?', '+waitingTasks+' waiting for input':'')+(blockedTasks?', '+blockedTasks+' blocked and needing review':'')+(activeTasks?', '+activeTasks+' active '+(activeTasks===1?'task':'tasks'):'')+(taskPreview?', '+taskLabel+taskPreview.slice(0,100):'')+(hasDraft?', unsent task draft':''));
        task.setAttribute('aria-label',enabledMembers?(hasDraft?'Resume the saved task draft in ':'Start a new group task in ')+group.name:group.name+' has no enabled Pods to receive tasks');
        task.disabled=!enabledMembers;
        if(!enabledMembers)task.title='No enabled Pods can receive group tasks';
        for(const member of group.members.slice(0,2)){const bot=bots.find(item=>item.id===member.botId)||member;faces.append(avatar(bot,'reply-avatar',podState(bot)))}
        copy.append(node('strong',group.name),node('span',group.members.map(member=>member.name).join(', ')));
        if(taskPreview){const preview=node('span',taskLabel+taskPreview,'mobile-group-task-preview');preview.dataset.state=groupRun.status;copy.append(preview)}
        meta.append(node('strong',enabledMembers+'/'+group.members.length+' enabled'));
        if(pausedMembers)meta.append(node('span',pausedMembers+' paused','mobile-group-paused'));
        if(waitingTasks)meta.append(node('span',waitingTasks+' waiting','mobile-group-attention'));
        if(blockedTasks)meta.append(node('span',blockedTasks+' blocked','mobile-group-attention'));
        if(activeTasks)meta.append(node('span',activeTasks+' active '+(activeTasks===1?'task':'tasks'),'mobile-group-activity'));
        meta.append(node('span',hasDraft?'Draft':'Open',hasDraft?'mobile-group-draft':''));
        open.append(faces,copy,meta);
        task.append(node('span','+','mobile-pod-task-icon'),node('span',taskActionLabel,'mobile-pod-task-label'));
        card.append(open,task);
        item.append(card);
        container.append(item)
      }
    });
    return
  }
  $('mobile-pods-list').setAttribute('aria-label','Pods');
  const statusFilter=document.querySelector('#mobile-pods-filters [aria-pressed="true"]')?.dataset.podsFilter||'all',labels={ready:'Ready',paused:'Paused',queued:'Queued',running:'Working',waiting:'Needs you',blocked:'Blocked',failed:'Failed',reconcile:'Review effects',completed:'Completed',cancelled:'Stopped'},searchMatches=bots.filter(bot=>[bot.name,bot.instructions,bot.projectRoot].join(' ').toLowerCase().includes(query)),filterCounts={all:searchMatches.length,attention:0,working:0,paused:0};
  for(const bot of searchMatches){const state=podOverviewState(bot);if(['waiting','blocked','failed','reconcile'].includes(state))filterCounts.attention++;if(['queued','running'].includes(state))filterCounts.working++;if(state==='paused')filterCounts.paused++}
  document.querySelectorAll('#mobile-pods-filters [data-pods-filter]').forEach(button=>{button.setAttribute('aria-pressed',String(button.dataset.podsFilter===statusFilter));button.querySelector('.mobile-pods-filter-count').textContent=filterCounts[button.dataset.podsFilter]});
  const matches=searchMatches.filter(bot=>{const state=podOverviewState(bot);return statusFilter==='all'||statusFilter==='attention'&&['waiting','blocked','failed','reconcile'].includes(state)||statusFilter==='working'&&['queued','running'].includes(state)||statusFilter==='paused'&&state==='paused'}),view=matches.map(bot=>[bot.id,bot.name,bot.instructions,bot.projectRoot,bot.enabled,podOverviewState(bot),drafts.get(bot.id)?.size||0]),count=bots.length+' '+(bots.length===1?'Pod':'Pods');
  const countText=query||statusFilter!=='all'?matches.length+' of '+count:count;if($('mobile-pods-count').textContent!==countText)$('mobile-pods-count').textContent=countText;
  update('mobile-pods-list',{view:'pods',query,statusFilter,selected,total:bots.length,pods:view},container=>{
    container.replaceChildren();
    if(!matches.length){const empty=node('li',undefined,'mobile-pods-empty'),hasPods=bots.length>0,filtered=Boolean(query)||statusFilter!=='all';empty.append(node('p',hasPods?'FILTERED ROSTER':'GET STARTED','eyebrow'),node('h2',hasPods?filtered?'No Pods in this view':'No Pods match':'Create your first Pod'),node('p',hasPods?filtered?'Change the search or status filter to see more Pods.':'Try another name, role or project folder.':'Give a project a clear owner, then send its first task.'));empty.append(button(hasPods?'Show all Pods':'Create your first Pod',()=>{if(hasPods){$('mobile-pods-search').value='';selectMobilePodsFilter('all');renderMobilePodsPage()}else openCreate()},hasPods?'':'primary'));container.append(empty);return}
    for(const bot of matches){const state=podOverviewState(bot),hasDraft=Boolean(drafts.get(bot.id)?.size),item=node('li',undefined,'mobile-pod-item'),card=node('div',undefined,'mobile-pod-card'),open=node('button','','mobile-pod-main'),copy=node('span',undefined,'mobile-pod-copy'),meta=node('span',undefined,'mobile-pod-meta'),task=button('',()=>{selectBot(bot.id);startNewConversation();void refresh()},'mobile-pod-task'),role=mobilePodCardDetail(bot,state);card.dataset.selected=String(bot.id===selected);open.type='button';open.setAttribute('aria-current',String(bot.id===selected));open.setAttribute('aria-label','Open '+bot.name+', '+(labels[state]||state)+(role.startsWith('Current task · ')?', '+role:'')+(hasDraft?', unsent task draft':'')+(bot.projectRoot?' · Project folder '+bot.projectRoot:''));open.append(avatar(bot,'mobile-pod-avatar',state));copy.append(node('strong',bot.name),node('span',role||'No responsibility set'));if(bot.projectRoot){const project=node('span','Project · '+projectLabel(bot.projectRoot),'mobile-pod-project');project.title='Project folder: '+bot.projectRoot;copy.append(project)}const status=node('span',labels[state]||state,'mobile-pod-state'),hint=node('span',hasDraft?'Draft':'Open','mobile-pod-open');status.dataset.state=state;if(hasDraft)hint.dataset.draft='true';meta.append(status,hint);open.append(copy,meta);task.setAttribute('aria-label','Start a new task with '+bot.name);task.append(node('span','+','mobile-pod-task-icon'),node('span','New task','mobile-pod-task-label'));open.addEventListener('click',()=>{selectBot(bot.id);void refresh()});card.append(open,task);item.append(card);container.append(item)}
  });
}
function openMobilePodsPage(view){if($('app').hidden)return;if(selectedGroup)saveGroupDraft(selectedGroup);mobilePodsPage=true;overviewMode=false;selectedGroup=null;$('agent-more').open=false;$('app').dataset.onboarding='false';$('app-layout').dataset.onboarding='false';document.querySelector('.workspace').dataset.overview='false';$('overview-link').setAttribute('aria-current','false');syncGroupWorkspace();setReviewOpen(false);if(view&&view!==mobilePodsView){selectMobileWorkspaceView(view);return}syncMobileTabs();if(mobilePodsView==='chats')searchMobileChats();else renderMobilePodsPage()}
function updateAssignTaskContext(){const bot=botsState.find(item=>item.id===$('assign-task-pod').value&&item.enabled),details=[];if(bot?.projectRoot)details.push('Project: '+bot.projectRoot);if(bot?.instructions)details.push('Responsibility: '+bot.instructions);$('assign-task-context').textContent=details.join(' · ')||'Ready for its next task.'}
function openAssignTask(){if($('app').hidden||document.querySelector('dialog:modal'))return;const pods=botsState.filter(bot=>bot.enabled);if(!pods.length){notify('Enable a Pod before assigning a task.');return}const form=$('assign-task-form'),select=$('assign-task-pod'),stateLabels={ready:'Ready',paused:'Paused',reconcile:'Review effects'};form.reset();form.querySelector('.error').textContent='';select.replaceChildren(new Option('Select a Pod','',{disabled:true}));for(const bot of pods){const state=podOverviewState(bot);select.add(new Option(bot.name+' · '+(stateLabels[state]||runStatusLabel(state)),bot.id))}select.value=pods.find(bot=>bot.id===selected)?.id||pods[0].id;updateAssignTaskContext();notify('');$('assign-task-dialog').showModal();select.focus()}
function quickOpenEntries(){
  const pods=botsState.map(bot=>({label:'Open '+bot.name,detail:(bot.id===selected?'Current · ':'')+(bot.projectRoot||'Pod')+' · '+(bot.activeStatus||bot.latestRun?.status||'Ready'),search:[bot.name,bot.projectRoot,bot.instructions].join(' '),run:()=>{selectBot(bot.id);void refresh()}}));
  const entries=[
    {label:'Team overview',detail:'Workspace',search:'team overview home all pods',run:()=>$('overview-link').click()},
    ...(botsState.some(bot=>bot.enabled)?[{label:'Assign a task',detail:'New conversation · Workspace action',search:'assign task start new work',run:openAssignTask}]:[]),
    {label:'Create a Pod',detail:'Workspace action',search:'create new pod teammate',run:openCreate},
    {label:'Create a group',detail:'Group chat · Workspace action',search:'create group collaboration group chat',run:openCreateGroup},
    {label:'Search task history',detail:'All Pods · Workspace action',search:'history past tasks results',run:openWorkspaceHistory},
    ...pods,
    ...workspaceConversationResults.filter(conversation=>!conversation.deleting&&!(selected&&!selectedGroup&&current&&conversation.botId===selected)).map(conversation=>{const hasDraft=hasConversationDraft(conversation.botId,conversation.id);return {label:conversation.title,detail:(hasDraft?'Draft · ':'')+conversation.botName+' · Conversation',search:[conversation.title,conversation.botName,hasDraft?'draft':''].join(' '),run:()=>{selectBot(conversation.botId);selectConversation(conversation.id);void refresh()}}}),
    ...groupsState.map(group=>({label:'Open '+group.name,detail:'Group chat · '+group.members.length+' Pods',search:[group.name,...group.members.map(member=>member.name)].join(' '),run:()=>{void selectGroup(group.id)}}))
  ];
  if(selected&&!selectedGroup&&current){
    entries.push({label:'New conversation',detail:current.bot.name+' · Action',search:'new conversation chat',run:startNewConversation});
    for(const [view,label] of [['conversation','Conversation'],['activity','Activity'],['scheduled','Scheduled'],['library','Saved results'],['profile','Profile']])entries.push({label,detail:current.bot.name+' · Pod view',search:label,run:()=>view==='conversation'?setReviewOpen(false):setReviewOpen(true,view)});
    for(const conversation of current.conversations||[])if(!conversation.deleting){const hasDraft=hasConversationDraft(current.bot.id,conversation.id);entries.push({label:conversation.title,detail:(hasDraft?'Draft · ':'')+current.bot.name+' · Conversation',search:[conversation.title,current.bot.name,hasDraft?'draft':''].join(' '),run:()=>selectConversation(conversation.id)})}
  }
  return entries;
}
function openWorkspaceHistory(){const dialog=$('workspace-history-dialog');if($('app').hidden||dialog.open||document.querySelector('dialog:modal'))return;workspaceHistoryRequest++;$('workspace-history-form').reset();$('workspace-history-form').querySelector('button[type=submit]').disabled=false;$('workspace-history-status').textContent='Find finished tasks across every Pod in this workspace.';$('workspace-history-results').replaceChildren();dialog.showModal();$('workspace-history-query').focus()}
function showWorkspaceHistory(results){const container=$('workspace-history-results');container.replaceChildren();$('workspace-history-status').textContent=results.length===20?'Showing the latest 20 matches. Refine your search for older tasks.':results.length+' matching '+(results.length===1?'task':'tasks')+' across your Pods.';for(const result of results){const item=node('article',undefined,'history-result'),meta=node('div',undefined,'history-result-meta');meta.append(node('strong',result.botName),node('span',runStatusLabel(result.status)+' · '+date(result.createdAt)+' · '+result.source));item.append(meta,node('p',result.promptExcerpt,'history-result-prompt'));if(result.resultExcerpt)item.append(node('p',result.resultExcerpt,'history-result-output'));const details=node('details'),summary=node('summary','Read full request and result');let loaded=false;details.append(summary);details.addEventListener('toggle',async()=>{if(!details.open||loaded)return;loaded=true;try{const task=await api('/api/runs/'+encodeURIComponent(result.runId)+'/summary');if(details.isConnected)details.append(renderHistorySummary(task,result.botName))}catch(error){loaded=false;if(details.isConnected)details.append(node('p',error.message,'error'))}});const reuse=button('Use as draft',async()=>{const data=await api('/api/runs/'+encodeURIComponent(result.runId)+'/prompt'),prompt=String(data.prompt||'');if(!prompt.trim())throw new Error('This task has no reusable prompt');if(hasConversationDraft(result.botId,null)&&!window.confirm('This Pod already has an unsent new-conversation draft. Replace it with this past prompt?'))return;$('workspace-history-dialog').close();selectBot(result.botId);startNewConversation();const message=$('message');message.value=prompt;message.dispatchEvent(new Event('input',{bubbles:true}))});reuse.setAttribute('aria-label','Use this past prompt as a new unsent draft for '+result.botName);reuse.title='Prefill a new conversation. Nothing is submitted until you send it.';item.append(details,node('div',undefined,'actions'));item.lastChild.append(button('Open Pod',()=>{if(details.open)details.open=false;$('workspace-history-dialog').close();selectBot(result.botId);void refresh()}),reuse);container.append(item)}}
function renderQuickOpen(){
  const query=$('quick-open-search').value.trim().toLowerCase();
  quickOpenMatches=quickOpenEntries().filter(item=>(item.label+' '+item.detail+' '+item.search).toLowerCase().includes(query));
  quickOpenSelection=quickOpenMatches.length?Math.min(quickOpenSelection,quickOpenMatches.length-1):0;
  const results=$('quick-open-results');results.replaceChildren();results.scrollTop=0;
  quickOpenMatches.forEach((item,index)=>{const option=document.createElement('button');option.type='button';option.className='quick-open-option';option.id='quick-open-option-'+index;option.setAttribute('role','option');option.setAttribute('aria-selected',String(index===quickOpenSelection));option.append(node('span',item.label,'quick-open-option-label'),node('span',item.detail,'quick-open-option-detail'));option.addEventListener('click',()=>{$('quick-open-dialog').close();item.run()});results.append(option)});
  $('quick-open-empty').hidden=Boolean(quickOpenMatches.length)||quickOpenSearchingConversations;$('quick-open-search').setAttribute('aria-expanded',String(Boolean(quickOpenMatches.length)));
  if(quickOpenMatches.length)$('quick-open-search').setAttribute('aria-activedescendant','quick-open-option-'+quickOpenSelection);else $('quick-open-search').removeAttribute('aria-activedescendant');
}
function quickOpenHelpText(){return matchMedia('(max-width: 1024px)').matches?'Tap a result to open.':'Up/Down to move | Enter to open | Esc to close'}
function searchWorkspaceConversations(query){const request=++quickOpenConversationRequest;clearTimeout(quickOpenConversationTimer);workspaceConversationResults=[];quickOpenSearchingConversations=Boolean(query);if(!quickOpenSearchingConversations){$('quick-open-help').textContent=quickOpenHelpText();renderQuickOpen();return}$('quick-open-help').textContent='Searching conversations…';renderQuickOpen();quickOpenConversationTimer=window.setTimeout(async()=>{try{const excludeBotId=selected&&!selectedGroup&&current?'&excludeBotId='+encodeURIComponent(selected):'',result=await api('/api/conversations?query='+encodeURIComponent(query)+excludeBotId);if(request!==quickOpenConversationRequest||!$('quick-open-dialog').open||$('quick-open-search').value.trim()!==query)return;workspaceConversationResults=result.conversations;quickOpenSearchingConversations=false;$('quick-open-help').textContent=result.hasMore?'Showing the 50 most recent matches. Refine your search for older conversations.':quickOpenHelpText();renderQuickOpen()}catch{if(request!==quickOpenConversationRequest||!$('quick-open-dialog').open)return;workspaceConversationResults=[];quickOpenSearchingConversations=false;$('quick-open-help').textContent='Conversation search is unavailable. Other Jump results still work.';renderQuickOpen()}},140)}
function openQuickOpen(){const dialog=$('quick-open-dialog');if($('app').hidden||dialog.open||document.querySelector('dialog:modal'))return;quickOpenConversationRequest++;clearTimeout(quickOpenConversationTimer);workspaceConversationResults=[];quickOpenSearchingConversations=false;$('quick-open-eyebrow').textContent='QUICK SWITCH';$('quick-open-title').textContent='Jump to anything';$('quick-open-search').setAttribute('aria-label','Search Pods, groups, conversations and actions');$('quick-open-search').placeholder='Search Pods, groups, conversations...';$('quick-open-empty').textContent='No matching Pods, groups, conversations or actions.';quickOpenSelection=0;$('quick-open-search').value='';$('quick-open-help').textContent=quickOpenHelpText();dialog.showModal();renderQuickOpen();$('quick-open-search').focus()}

function selectBot(id){
  $('agent-more').open=false;mobilePodsPage=false;overviewMode=false;syncMobileTabs();$('app').dataset.onboarding='false';$('app-layout').dataset.onboarding='false';document.querySelector('.workspace').dataset.overview='false';$('overview-link').setAttribute('aria-current','false');browserOpen.textContent='Open computer';reviewOpen=false;pendingDecisions=0;observedDecisionBot=null;observedDecisionIds.clear();
  rememberCurrentDraft();rememberActiveConversation();selected=id;const active=activeConversations.get(id);setConversationContext(active?.conversationId??null,active?.newConversationDraft??false);
  $('project-context').hidden=true;$('project-root-path').textContent='';current=null;syncMobileConversationTrigger([]);setReviewOpen(false);$('review-count').hidden=true;$('activity-view').setAttribute('aria-label','Activity');closeDialogs();restoreDraft(id,selectedConversation);signatures.clear();eventCursor=0;eventItems=[];
  for(const id of ['feed','decisions','routines','notes','procedures','activity-list','deliveries','history-results'])$(id).replaceChildren();$('history-search-form').reset();$('history-search-form').querySelector('.error').textContent=''
}
const appearanceOptions=${JSON.stringify(POD_APPEARANCE_OPTIONS)};
let reviewView='activity';
// Keep the original defaults stable for Pods created before saved appearance existed.
function defaultAppearance(name){let hash=0;for(const char of String(name||'Pod'))hash=(hash*31+char.charCodeAt(0))>>>0;return {shape:appearanceOptions.shape[hash%7],tone:appearanceOptions.tone[(hash>>>3)%5],eyes:'round',accessory:'none'}}
function podAppearance(pod){return pod?.appearance||defaultAppearance(pod?.name)}
function setAvatar(container,pod,state='ready',editable=false){
  const appearance=podAppearance(pod);
  container.classList.add('pod-avatar');container.dataset.tone=appearance.tone;container.dataset.state=state;
  if(!editable)container.setAttribute('aria-hidden','true');
  window.Pod3D.mount(container,appearance,state,editable);
}
function avatar(pod,className,state='ready'){const el=node('span',undefined,className);setAvatar(el,pod,state);return el}
function podState(pod,runs){return !pod.enabled?'paused':current?.bot.id===pod.id&&current.decisions.length?'waiting':['waiting','blocked','running','queued'].find(state=>runs?.some(run=>run.status===state))||pod.activeStatus||pod.latestRun?.status||'ready'}
function setReviewOpen(open,view=reviewView){reviewOpen=Boolean(open&&selected);reviewView=view;$('review-panel').dataset.view=view;$('review-title').textContent={activity:'Activity',scheduled:'Scheduled',profile:'Profile',library:'Library'}[view];$('review-panel').hidden=!reviewOpen;$('app-layout').classList.toggle('with-review-panel',reviewOpen);$('mobile-workspace-view').value=reviewOpen?view:'conversation';for(const tab of document.querySelectorAll('[data-workspace-view]'))tab.setAttribute('aria-pressed',String(tab.dataset.workspaceView===(reviewOpen?view:'conversation')));if(reviewOpen&&$('browser-dialog').open)$('browser-dialog').close()}
function updateReviewAttention(decisions){const ids=new Set(decisions.map(decision=>decision.id));const hasNew=selected!==observedDecisionBot||[...ids].some(id=>!observedDecisionIds.has(id));if(ids.size&&hasNew){reviewOpen=true;reviewView='activity'}observedDecisionBot=selected;observedDecisionIds=ids}
function showBots(bots){botsState=bots;syncMobileTabs();$('bot-count').textContent=String(bots.length);$('overview-count').textContent=String(bots.length);update('bots',{bots,selected,overviewMode,search:$('pod-search').value,seen:[...seenActivity],attention:current?.decisions?.length||0},container=>{container.replaceChildren();const query=$('pod-search').value.trim().toLowerCase();const matches=bots.filter(bot=>(bot.name+' '+bot.instructions).toLowerCase().includes(query));for(const bot of matches){const el=button('',async()=>{if(selected===bot.id&&!selectedGroup&&!overviewMode)return;selectBot(bot.id);await refresh()},'bot'+(selected===bot.id&&!overviewMode?' selected':''));el.setAttribute('aria-current',selected===bot.id&&!overviewMode?'true':'false');const state=podState(bot);el.dataset.state=state;el.title=bot.name+' · '+state;const character=avatar(bot,'bot-avatar',state);const details=node('span',undefined,'bot-details');details.append(node('strong',bot.name));const stamp=activityStamp(bot);if(stamp&&seenActivity.get(bot.id)!==stamp){const unread=node('span','New','unread-dot');unread.setAttribute('aria-label','Unread activity');details.append(unread)}const meta=node('span',undefined,'bot-meta');const statusLabel=node('span',state,'agent-status');statusLabel.dataset.state=state;meta.append(statusLabel);const previewText=bot.latestRun?.output||bot.latestRun?.prompt||'';const preview=node('span',previewText?previewText.replace(/\s+/g,' ').slice(0,88):(bot.enabled?bot.instructions:'Pod paused'),'bot-preview');if(previewText)preview.title=previewText;meta.append(preview);details.append(meta);el.append(character,details);container.append(el)}if(!matches.length)container.append(node('p',bots.length?'No matching Pods.':'Your first Pod starts here.','muted'))})}
function showNoAgents(){
  mobilePodsPage=false;syncMobileTabs();
  $('app').dataset.onboarding='true';
  $('app-layout').dataset.onboarding='true';
  document.querySelector('.workspace').dataset.overview='false';
  $('overview-link').setAttribute('aria-current','page');
  setReviewOpen(false);showConversations([]);
  $('new-conversation').hidden=true;$('new-conversation-main').hidden=true;$('pod-settings').hidden=true;
  pendingDecisions=0;$('review-count').hidden=true;$('activity-view').setAttribute('aria-label','Activity');
  $('bot-name').textContent='Your Pods';setAvatar($('bot-avatar'),{name:'Pod'});
  $('agent-state').textContent='Ready';$('agent-state').dataset.state='ready';
  $('responsibility').textContent='Give an agent a project folder and a clear responsibility. You can add tasks, routines and review settings after setup.';
  $('run-count').textContent='';$('active-count').textContent='0';$('attention-count').textContent='0';$('completed-count').textContent='0';
  const empty=node('section',undefined,'empty-state');
  empty.append(avatar({name:'Pod'},'hero-avatar'),node('p','FIRST POD','eyebrow'),node('h2','Give a project its first Pod.'),node('p','Choose a project folder, set what your Pod owns, then send a task. Its conversations and results stay in this workspace.'));
  const steps=node('ol',undefined,'onboarding-steps');
  for(const [number,label] of [['01','Choose a project folder'],['02','Give your Pod a clear role'],['03','Send the first task']]){const step=node('li',undefined,'onboarding-step');step.append(node('span',number,'onboarding-step-number'),node('span',label,'onboarding-step-label'));steps.append(step)}
  empty.append(steps);
  const actions=node('div',undefined,'actions'),create=node('button','Create your first Pod','primary');
  create.type='button';create.addEventListener('click',openCreate);actions.append(create);empty.append(actions);
  $('feed').replaceChildren(empty);
}
function showOverview(bots,recentRuns,activeRuns=[],groupRuns=[]){
  $('app').dataset.onboarding='false';$('app-layout').dataset.onboarding='false';
  const workspace=document.querySelector('.workspace');
  workspace.dataset.overview='true';workspace.dataset.group='false';$('overview-link').setAttribute('aria-current','page');
  setReviewOpen(false);syncMobileTabs();
  const stateOf=podOverviewState;
  const labels={ready:'Ready',paused:'Paused',queued:'Queued',running:'Working',waiting:'Needs you',blocked:'Blocked',failed:'Failed',reconcile:'Review effects',completed:'Completed',cancelled:'Stopped'};
  const visibleBots=bots.filter(bot=>overviewFilter==='working'?['queued','running'].includes(stateOf(bot)):overviewFilter==='attention'?['waiting','blocked','failed','reconcile'].includes(stateOf(bot)):true);
  const attentionState=overviewAttentionFor(bots,groupRuns);
  const draftsToResume=workspaceDrafts(bots),draftSnapshot=draftsToResume.map(({kind,id,conversationId,owner,destination,preview})=>[kind,id,conversationId,owner,destination,preview]);
  update('feed',{overview:bots,filter:overviewFilter,recentRuns,activeRuns,groupRuns,drafts:draftSnapshot},container=>{
    container.replaceChildren();
    const shell=node('section',undefined,'overview-shell');
    const working=bots.filter(bot=>['queued','running'].includes(stateOf(bot))).length;
    const attentionPriority={reconcile:0,waiting:1,blocked:2,failed:3},attentionActions={reconcile:'Review effects',waiting:'Review request',blocked:'Review blocked task',failed:'Inspect failure'},attention=attentionState.pods,groupAttention=attentionState.groups;
    const intro=node('header',undefined,'overview-intro'),heading=node('div');
    heading.append(node('p','WORKSPACE / OVERVIEW','eyebrow'),node('h1','Your team, in motion.'));
    heading.append(node('p','A live view of Pods and group work, with what needs you up front.'));
    const actions=node('div',undefined,'actions'),create=node('button','Create Pod'),assign=node('button','Assign a task','primary');
    create.type='button';create.addEventListener('click',openCreate);if(bots.some(bot=>bot.enabled)){assign.type='button';assign.addEventListener('click',openAssignTask);actions.append(assign)}actions.append(create);intro.append(heading,actions);shell.append(intro);
    if(draftsToResume.length){const panel=node('section',undefined,'overview-panel overview-drafts'),header=node('header',undefined,'overview-panel-header'),list=node('div',undefined,'overview-drafts-list');header.append(node('h2','Drafts to continue'),node('span',String(draftsToResume.length)));panel.append(header);for(const draft of draftsToResume){const item=node('button','', 'overview-draft-item'),copy=node('span',undefined,'overview-draft-copy');item.type='button';item.setAttribute('aria-label','Continue '+draft.owner+' · '+draft.destination+' draft. '+draft.preview);item.addEventListener('click',()=>resumeWorkspaceDraft(draft));copy.append(node('strong',draft.owner+' · '+draft.destination),node('span',draft.preview));item.append(copy,node('span','Continue','overview-draft-action'));list.append(item)}panel.append(list);shell.append(panel)}
    const metrics=node('section',undefined,'overview-metrics');metrics.setAttribute('aria-label','Workspace status');
    const openRun=run=>{if(run.groupId&&groupsState.some(group=>group.id===run.groupId)){void selectGroup(run.groupId);return}selectBot(run.botId);if(run.conversationId)selectConversation(run.conversationId);void refresh()};
    for(const [filter,value,label] of [['all',bots.length,'All Pods'],['working',working,'Active Pods'],['attention',attentionState.count,'Needs you']]){const metric=node('button','', 'overview-metric');metric.type='button';metric.setAttribute('aria-pressed',String(overviewFilter===filter));metric.addEventListener('click',()=>{overviewFilter=filter;showOverview(bots,recentRuns,activeRuns,groupRuns)});metric.append(node('strong',String(value)),node('span',label));metrics.append(metric)}
    shell.append(metrics);
    const panels=node('div',undefined,'overview-panels'),team=node('section',undefined,'overview-panel overview-team'),teamHeader=node('header',undefined,'overview-panel-header'),podList=node('div',undefined,'overview-pod-list');
    teamHeader.append(node('h2','Your Pods'),node('span',overviewFilter==='all'?bots.length+' total':visibleBots.length+' of '+bots.length));team.append(teamHeader,podList);
    if(!visibleBots.length){const clear=node('div',undefined,'overview-clear'),canAssign=overviewFilter==='working'&&bots.some(bot=>bot.enabled);clear.append(node('strong',overviewFilter==='working'?'No active work right now':'No Pods need attention'),node('span',overviewFilter==='working'?'Queued and running tasks will appear here.':'Pod decisions appear here; group items stay in Needs your attention above.'),button(canAssign?'Assign a task':'View all Pods',()=>{if(canAssign)openAssignTask();else{overviewFilter='all';showOverview(bots,recentRuns,activeRuns,groupRuns)}},'primary'));podList.append(clear)}
    for(const bot of visibleBots){
      const state=stateOf(bot),run=bot.latestRun,card=node('div',undefined,'overview-pod'),open=node('button','', 'overview-pod-open');open.type='button';
      open.setAttribute('aria-label',bot.name+(bot.projectRoot?', Project folder '+bot.projectRoot:'')+', '+(labels[state]||state)+'. Open Pod.');open.addEventListener('click',()=>{selectBot(bot.id);void refresh()});
      open.append(avatar(bot,'overview-avatar',state));
      const copy=node('span',undefined,'overview-pod-copy'),description=node('span',run?.prompt||bot.instructions||'Ready for its first assignment.','overview-pod-description');copy.append(node('strong',bot.name));if(bot.projectRoot){const project=node('span','Project · '+projectLabel(bot.projectRoot),'overview-pod-project');project.title='Project folder: '+bot.projectRoot;copy.append(project)}copy.append(description);
      const meta=node('span',undefined,'overview-pod-meta'),badge=node('span',labels[state]||state,'overview-status');badge.dataset.state=state;meta.append(badge);if(run?.updatedAt)meta.append(node('time',date(run.updatedAt)));copy.append(meta);open.append(copy);
      const start=button('New task',()=>{selectBot(bot.id);startNewConversation();void refresh()},'overview-pod-new-task');start.setAttribute('aria-label','Start a new task with '+bot.name);card.append(open,start);podList.append(card);
    }
    const attentionPanel=node('section',undefined,'overview-panel overview-attention'),attentionHeader=node('header',undefined,'overview-panel-header');attentionPanel.dataset.hasItems=String(attentionState.count>0);
    attentionHeader.append(node('h2','Needs your attention'),node('span',String(attentionState.count)));attentionPanel.append(attentionHeader);
    const attentionItems=[...attention.map(bot=>({kind:'pod',bot,state:stateOf(bot)})),...groupAttention.map(entry=>({kind:'group',entry,state:entry.runs.some(run=>run.status==='waiting')?'waiting':'blocked'}))].sort((a,b)=>attentionPriority[a.state]-attentionPriority[b.state]);
    if(!attentionState.count){const clear=node('div',undefined,'overview-clear');clear.append(node('strong','All clear'),node('span','No Pod or group task needs input, review, recovery or effects verification.'));attentionPanel.append(clear)}
    else for(const entry of attentionItems){
      if(entry.kind==='group'){
        const groupEntry=entry.entry,group=groupEntry.group,waiting=groupEntry.runs.filter(run=>run.status==='waiting').length,blocked=groupEntry.runs.filter(run=>run.status==='blocked').length,run=groupEntry.runs[0],bot=bots.find(item=>item.id===run.botId),item=node('button','', 'overview-attention-item');item.type='button';item.setAttribute('aria-label','Open '+group.name+' group chat, '+waiting+' waiting for input and '+blocked+' blocked for review');item.addEventListener('click',()=>{if(groupsState.some(item=>item.id===group.id))void selectGroup(group.id)});item.append(avatar(bot||{name:run.botName},'overview-attention-avatar',entry.state));const copy=node('span',undefined,'overview-attention-copy'),counts=[];if(waiting)counts.push(waiting+' waiting for input');if(blocked)counts.push(blocked+' blocked for review');copy.append(node('strong',group.name+' · '+(waiting?'Needs input':'Review needed')),node('span',[...counts,run.promptExcerpt||'Open the group chat to review replies.'].join(' · ')));item.append(copy,node('span','Open group','overview-attention-action'));attentionPanel.append(item);continue
      }
      const bot=entry.bot,state=entry.state,run=bot.latestRun,item=node('button','', 'overview-attention-item');item.type='button';
      item.setAttribute('aria-label',attentionActions[state]+' for '+bot.name);
      item.addEventListener('click',()=>{if(state==='reconcile'){reviewRun=bot.unreconciledRuns[0];$('reconcile-dialog').showModal();return}selectBot(bot.id);if(run?.conversationId)selectConversation(run.conversationId);if(state==='waiting'){$('decisions').replaceChildren(node('p','Loading pending requests…','muted'));setReviewOpen(true,'activity');$('close-review').focus()}else if(!run?.conversationId){setReviewOpen(true,'activity');$('close-review').focus()}void refresh()});
      item.append(avatar(bot,'overview-attention-avatar',state));
      const copy=node('span',undefined,'overview-attention-copy'),count=bot.unreconciledRuns?.length||0,detail=state==='reconcile'?count+' interrupted '+(count===1?'task has':'tasks have')+' effects that need verification.':run?.prompt||'Open this Pod to review what happened.';
      copy.append(node('strong',bot.name+' · '+(labels[state]||state)),node('span',detail));item.append(copy,node('span',attentionActions[state],'overview-attention-action'));attentionPanel.append(item)
    }
    panels.append(team,attentionPanel);
    if(activeRuns.length){const activePanel=node('section',undefined,'overview-panel overview-active-work'),activeHeader=node('header',undefined,'overview-panel-header'),activeList=node('div',undefined,'overview-active-list');activeHeader.append(node('h2','In progress'),node('span',String(activeRuns.length)));activePanel.append(activeHeader,activeList);for(const run of activeRuns){const bot=bots.find(item=>item.id===run.botId);if(!bot)continue;const status=labels[run.status]||run.status,title=run.groupName?run.groupName+' · '+run.botName:run.botName,item=node('button','', 'overview-recent-item overview-active-item');item.type='button';item.setAttribute('aria-label','Open '+(run.promptExcerpt||'task')+' from '+title+', '+status);item.addEventListener('click',()=>openRun(run));item.append(avatar(bot,'overview-recent-avatar',run.status));const copy=node('span',undefined,'overview-recent-copy');copy.append(node('strong',title),node('span',run.promptExcerpt||'No task description'));item.append(copy);const tail=node('span',undefined,'overview-recent-tail'),badge=node('span',status,'overview-status');badge.dataset.state=run.status;tail.append(badge,node('time',date(run.createdAt)));item.append(tail);activeList.append(item)}panels.append(activePanel)}
    const recentPanel=node('section',undefined,'overview-panel overview-recent'),recentHeader=node('header',undefined,'overview-panel-header overview-recent-header'),recentList=node('div',undefined,'overview-recent-list');
    recentHeader.append(node('h2','Recent tasks'),button('Search history',openWorkspaceHistory));recentPanel.append(recentHeader,recentList);
    if(!recentRuns.length){const clear=node('div',undefined,'overview-first-task'),copy=node('div',undefined,'overview-first-task-copy');if(activeRuns.length){copy.append(node('strong','No recent tasks'),node('span','Queued and running tasks are listed in In progress above. Tasks that need attention or have finished will appear here.'));clear.append(copy)}else{const starterBot=bots.find(bot=>bot.enabled)||bots[0],canStart=starterBot.enabled,openTask=async()=>{if(!canStart)await api('/api/bots/'+encodeURIComponent(starterBot.id)+'/enabled',{enabled:true});selectBot(starterBot.id);startNewConversation()};copy.append(node('strong','No recent tasks'),node('span',canStart?'Choose a guided prompt for '+starterBot.name+' and review it before sending.':'Enable '+starterBot.name+' to open a task draft. Nothing is sent until you choose a prompt.'));clear.append(copy,button(canStart?'Start a task':'Enable & choose a task',openTask,'primary'))}recentList.append(clear)}
    else for(const run of recentRuns){const bot=bots.find(item=>item.id===run.botId);if(!bot)continue;const status=labels[run.status]||run.status,title=run.groupName?run.groupName+' · '+run.botName:run.botName,item=node('button','', 'overview-recent-item');item.type='button';item.setAttribute('aria-label','Open '+(run.promptExcerpt||'task')+' from '+title+', '+status);item.addEventListener('click',()=>openRun(run));item.append(avatar(bot,'overview-recent-avatar',run.status));const copy=node('span',undefined,'overview-recent-copy');copy.append(node('strong',title),node('span',run.promptExcerpt||'No task description'));item.append(copy);const tail=node('span',undefined,'overview-recent-tail'),badge=node('span',status,'overview-status');badge.dataset.state=run.status;tail.append(badge,node('time',date(run.createdAt)));item.append(tail);recentList.append(item)}
    if(recentRuns.length)shell.append(panels,recentPanel);else if(activeRuns.length)shell.append(panels);else shell.append(recentPanel,panels);container.append(shell);
  });
}
function renderRunPrompt(run){if(run.prompt.length<=320)return node('p',run.prompt,'prompt');const details=node('details',undefined,'prompt-details'),summary=node('summary'),preview=run.prompt.replace(/\s+/g,' ').trim(),excerpt=preview.slice(0,220).replace(/[\uD800-\uDBFF]$/,'');details.dataset.promptRun=run.id;details.open=runPromptOpen.has(run.id);summary.append(node('span',excerpt+(preview.length>220?'…':''),'prompt-preview'),node('span',details.open?'Hide full task':'Show full task','prompt-expand'));details.append(summary);let loaded=false;const showFull=()=>{if(loaded||!details.open)return;loaded=true;details.append(node('p',run.prompt,'prompt prompt-full'))};if(details.open)showFull();details.addEventListener('toggle',()=>{if(details.open)runPromptOpen.add(run.id);else runPromptOpen.delete(run.id);summary.querySelector('.prompt-expand').textContent=details.open?'Hide full task':'Show full task';showFull()});return details}
const TASK_STARTERS=[
  ['01','Map this project','Get oriented before delegating.','Explore this project and summarize its main areas, entry points, and how to run it. Cite the paths you inspected; do not edit files.'],
  ['02','Review changes','Surface concrete risks with file references.','Review the current changes in this project and flag concrete regressions with file and line references. Do not edit files.'],
  ['03','Improve this project','Make a focused change that saves effort.','Inspect this project and my Pod’s responsibility, then implement one focused change that improves a real user workflow. Follow the project instructions, avoid unrelated changes, run relevant checks, and summarize the user impact.'],
];
const GROUP_TASK_STARTERS=[
  ['Map in parallel','Get a shared view of the project.','Each selected Pod should inspect an area suited to its responsibility. Report key files, useful commands and findings; do not edit files.'],
  ['Review changes','Find concrete risks with evidence.','Review the current project changes from your area of expertise. Report actionable issues with file and line references; do not edit files.'],
  ['Compare approaches','Bring several perspectives to one decision.','Analyze the requested problem from your Pod’s perspective. Propose one approach, cite relevant project files and explain the trade-offs; do not edit files.']
];
function showRuns(runs,unreconciled,guidance,legacyTranscript){update('feed',{runs,unreconciled,guidance,legacyTranscript,pod:current?.bot,activity:activityVersion},container=>{const followBottom=!container.childElementCount||container.scrollHeight-container.scrollTop-container.clientHeight<80;const scrollTop=container.scrollTop;const open=new Set([...container.querySelectorAll('details[open]')].map(el=>el.dataset.run));container.replaceChildren();const starterPrompts=$('starter-prompts');starterPrompts.dataset.available=String(!runs.length);starterPrompts.hidden=Boolean(runs.length||$('message').value.trim());starterPrompts.querySelector('.suggestions')?.remove();const activityRuns=current?.runs||runs,active=activityRuns.filter(run=>['queued','running'].includes(run.status)).length;const attention=activityRuns.filter(run=>['waiting','blocked','failed'].includes(run.status)||unreconciled.includes(run.id)).length;const completed=activityRuns.filter(run=>run.status==='completed').length;$('active-count').textContent=String(active);$('attention-count').textContent=String(attention);$('completed-count').textContent=String(completed);$('run-count').textContent=activityRuns.length===1?'1 task':activityRuns.length+' tasks';if(!runs.length){const empty=node('section',undefined,'empty-state has-quick-starts');empty.append(avatar(current?.bot,'hero-avatar'),node('h2','What can '+(current?.bot.name||'your Pod')+' help with?'),node('p','Choose a quick start below or write your own task.'));const suggestions=node('div',undefined,'suggestions');suggestions.setAttribute('role','group');suggestions.setAttribute('aria-label','Suggested starting tasks');const starters=TASK_STARTERS;for(const [number,title,detail,prompt] of starters){const choice=node('button',undefined,'task-starter');choice.type='button';choice.append(node('span',number,'task-starter-index'),node('strong',title),node('span',detail,'task-starter-detail'));choice.addEventListener('click',()=>{const message=$('message');message.value=prompt;messageKey=null;if(selected){saveDraft(selected,selectedConversation,prompt,null);showConversations()}$('starter-prompts').hidden=true;message.focus();message.setSelectionRange(prompt.length,prompt.length)});suggestions.append(choice)}starterPrompts.append(suggestions);container.append(empty)}const ordered=[...runs].reverse().sort((a,b)=>Date.parse(a.createdAt)-Date.parse(b.createdAt));for(const run of ordered){const el=node('article',undefined,'turn');const head=node('div',undefined,'row spread');head.append(node('span',(run.testMode?'Safe test · ':'')+runStatusLabel(run.status),'badge '+run.status),node('time',date(run.createdAt)));el.append(head,renderRunPrompt(run));if(!run.output&&!run.error){const stateCopy={queued:'Queued — this agent will start when it is free.',running:'Working now — new activity will appear here.',waiting:'Waiting for your input to continue.',blocked:'Paused for review. Check the action details before retrying.',completed:'Task completed.',failed:'This task could not finish. Open its details or retry.',cancelled:'This task was stopped.'}[run.status];if(stateCopy){const progress=node('div',undefined,'run-state-line '+run.status);progress.append(node('span',undefined,'run-pulse'),node('span',stateCopy));el.append(progress)}}for(const message of guidance.filter(message=>message.runId===run.id)){const intervention=node('div',undefined,'guidance-message');intervention.append(node('p',message.content,'prompt'),node('p',message.sequence<=run.steeringCursor?'Guidance received by the agent':'Guidance saved — awaiting the agent','muted'));el.append(intervention)}const activity = renderRunActivity(run);if(activity)el.append(activity);if(run.output){const reply=node('div',undefined,'agent-reply');reply.append(avatar(current?.bot,'reply-avatar',run.status));const content=node('div',undefined,'reply-content');content.append(node('span',current?.bot.name||'Agent','reply-name'),['queued','running','waiting'].includes(run.status)?renderPodLiveOutput(run.output,true):renderPodIntelligentAnswer(run.output));if(run.status==='completed'){const resultActions=node('div',undefined,'reply-result-actions');resultActions.append(copyButton(run.output),downloadResultButton(run),button('Saved in Library',()=>setReviewOpen(true,'library'),'result-link'));content.append(resultActions)}reply.append(content);el.append(reply)}if(run.error)el.append(node('p',run.error,'error'));const actions=node('div',undefined,'actions');if(run.status==='waiting')actions.append(button('Review request',()=>setReviewOpen(true,'activity'),'primary'));if(['running','waiting'].includes(run.status)&&run.acceptingMessages)actions.append(button('Guide task',async()=>{guideRun=run.id;guideKey=crypto.randomUUID();$('guide-dialog').showModal()}));if(['queued','running','waiting','blocked'].includes(run.status))actions.append(button('Stop task',()=>api('/api/runs/'+run.id+'/cancel',{}),'danger'));if(unreconciled.includes(run.id)){actions.append(button('Review effects',async()=>{reviewRun=run.id;$('reconcile-dialog').showModal()}))}else if(['failed','blocked'].includes(run.status)&&run.owner===null){actions.append(button('Retry task',()=>api('/api/runs/'+run.id+'/retry',{reconciled:run.status==='blocked'})))}if(run.status==='completed'&&run.owner===null&&run.browserStepCount>1)actions.append(button('Learn browser skill',async()=>{learnRun=run.id;$('learn-dialog').showModal()}));if(actions.childNodes.length)el.append(actions);const info=node('details');info.dataset.run=run.id;info.open=open.has(run.id);info.append(node('summary','Read request and result'),node('p','Occurrence: '+run.occurrenceId,'muted'));let loaded=false;info.addEventListener('toggle',()=>{if(!info.open||loaded)return;loaded=true;info.append(renderHistorySummary(run,current?.bot.name))});el.append(info);container.append(el)}if(legacyTranscript?.length){const legacy=node('details');legacy.append(node('summary','Legacy technical transcript'),node('p','Preserved from before task isolation. It is not used as context for any new task.','muted'),node('pre',JSON.stringify(legacyTranscript,null,2)));container.append(legacy)}container.scrollTop=runs.length?(followBottom?container.scrollHeight:scrollTop):0})}
function showHistory(results){const container=$('history-results');container.replaceChildren();if(!results.length){container.append(node('p','No matching finished tasks in this agent history.','muted'));return}for(const result of results){const item=node('div',undefined,'routine');item.append(node('p',runStatusLabel(result.status)+' · '+date(result.createdAt)+' · '+result.source,'muted'),node('p',result.promptExcerpt,'prompt'));if(result.resultExcerpt)item.append(node('p',result.resultExcerpt));const details=node('details');details.append(node('summary','Read full request and result'));let loaded=false;details.addEventListener('toggle',async()=>{if(!details.open||loaded)return;loaded=true;try{const task=await api('/api/runs/'+encodeURIComponent(result.runId)+'/summary');if(details.isConnected)details.append(renderHistorySummary(task,current?.bot.name))}catch(error){loaded=false;if(details.isConnected)details.append(node('p',error.message,'error'))}});item.append(details);container.append(item)}}
function showDecisions(decisions){updateReviewAttention(decisions);pendingDecisions=decisions.length;$('review-count').textContent=String(pendingDecisions);$('review-count').hidden=!pendingDecisions;$('activity-view').setAttribute('aria-label',pendingDecisions?'Activity, '+pendingDecisions+' items need your attention':'Activity');setReviewOpen(reviewOpen);update('decisions',decisions,container=>{container.replaceChildren();container.closest('section')?.classList.toggle('has-attention',decisions.length>0);if(!decisions.length){container.append(node('p','All clear. Requests for approval appear here.','muted'));return}for(const decision of decisions){const el=node('div',undefined,'decision');el.append(node('h3',decision.kind==='question'?'A question for you':'Approve an action'));if(decision.kind==='permission'){el.append(node('p',decision.request.riskDescription||decision.request.message||'Review this action before it runs.','muted'),node('pre',JSON.stringify(decision.request,null,2)));const actions=node('div',undefined,'actions');for(const [label,answer] of [['Approve once','once'],['Decline','deny']])actions.append(button(label,()=>api('/api/decisions/'+decision.id,{fingerprint:decision.fingerprint,answer}),answer==='once'?'primary':'danger'));el.append(actions)}else if(decision.kind==='question'){const form=node('form');const questions=Array.isArray(decision.request.questions)?decision.request.questions:[];questions.forEach((q,i)=>{const label=node('label',q.question);const input=node('textarea');input.name=String(i);input.placeholder=q.placeholder||'';input.required=true;label.append(input);if(q.options)label.append(node('p',q.options.map(o=>o.label+(o.description?' — '+o.description:'')).join('\n'),'muted'));form.append(label)});const submit=node('button','Send answer','primary');submit.type='submit';form.append(submit);form.addEventListener('submit',event=>{event.preventDefault();perform(submit,()=>api('/api/decisions/'+decision.id,{fingerprint:decision.fingerprint,answer:Object.fromEntries(new FormData(form))}))});el.append(form,button('Skip question',()=>api('/api/decisions/'+decision.id,{fingerprint:decision.fingerprint,answer:null})))}else el.append(node('pre',JSON.stringify(decision.request,null,2)));container.append(el)}})}
function scheduleText(schedule){let text;if(schedule.kind==='daily')text='Daily at '+String(schedule.hour).padStart(2,'0')+':'+String(schedule.minute).padStart(2,'0')+' ('+schedule.timeZone+')';else if(schedule.kind==='interval')text='Every '+schedule.everyMs/60000+' minutes';else if(schedule.kind==='once')text=date(schedule.at);else text='On event: '+schedule.topic;return schedule.endsAt===undefined?text:text+' · through '+date(schedule.endsAt)}
function showRoutines(routines){update('routines',routines,container=>{container.replaceChildren();if(!routines.length)container.append(node('p','No routines scheduled.','muted'));for(const routine of routines){const el=node('div',undefined,'routine');el.append(node('strong',routine.name),node('p',scheduleText(routine.schedule),'muted'),node('p',routine.prompt),node('p',!routine.enabled?'Paused':routine.nextAt!==null?'Next: '+date(routine.nextAt):routine.schedule.kind==='event'?'Waiting for event: '+routine.schedule.topic:'No upcoming run','routine-next'));const actions=node('div',undefined,'actions');actions.append(button('Test safely',async()=>{const occurrenceId=crypto.randomUUID();await api('/api/bots/'+selected+'/routines/'+routine.id+'/test',{occurrenceId})}),button('Run once',async()=>{if(!window.confirm('Run this routine now? It may perform real actions and will still use the normal approval checks.'))return;let occurrenceId=routineRunKeys.get(routine.id);if(!occurrenceId){occurrenceId=crypto.randomUUID();routineRunKeys.set(routine.id,occurrenceId)}await api('/api/bots/'+selected+'/routines/'+routine.id+'/run',{occurrenceId});routineRunKeys.delete(routine.id)}),button('Edit routine',()=>openRoutine(routine)),button(routine.enabled?'Pause routine':'Enable routine',()=>api('/api/bots/'+selected+'/routines/'+routine.id,{enabled:!routine.enabled,version:routine.version})),button('Delete routine',async()=>{if(!window.confirm('Delete this schedule? Work already queued from it will continue as a separate task.'))return;await api('/api/bots/'+selected+'/routines/'+routine.id+'/delete',{version:routine.version});routineRunKeys.delete(routine.id)},'danger'));el.append(actions);const history=node('details');const summary=node('summary','Recent runs');history.append(summary);let loaded=false;history.addEventListener('toggle',async()=>{if(!history.open||loaded)return;loaded=true;try{const runs=await api('/api/bots/'+selected+'/routines/'+routine.id+'/runs');if(!history.isConnected)return;if(!runs.length)history.append(node('p','No runs recorded yet.','muted'));for(const run of runs){const item=node('div');item.append(node('p',(run.testMode?'Safe test · ':'')+runStatusLabel(run.status)+' · '+date(run.createdAt),'muted'),node('p',run.prompt,'prompt'));if(run.output)item.append(node('p',run.output));if(run.error)item.append(node('p',run.error,'error'));history.append(item)}}catch(error){loaded=false;if(history.isConnected)history.append(node('p',error.message,'error'))}});el.append(history);container.append(el)}})}
function showProcedures(procedures){update('procedures',procedures,container=>{container.replaceChildren();if(!procedures.length)container.append(node('p','Learn a skill from a completed browser task.','muted'));for(const skill of procedures){const el=node('div',undefined,'routine');el.append(node('strong',skill.name),node('p',skill.status==='ready'?'Ready — every use rechecks the current page':'Needs a fresh demonstration','muted'),node('p','Observed '+date(skill.createdAt),'muted'));const link=node('a','Download SKILL.md');link.href='/api/bots/'+selected+'/procedures/'+skill.id;link.download='SKILL.md';el.append(link);container.append(el)}})}
function showNotes(notes){update('notes',notes,container=>{container.replaceChildren();if(!notes.length)container.append(node('p','The agent has no saved notes yet.','muted'));for(const note of notes){const el=node('div',undefined,'note');el.append(node('p',note.content),node('p','Source: '+note.source,'muted'),button('Edit note',()=>openNote(note)));container.append(el)}})}
function showDeliveries(targets,history){update('deliveries',{targets,history},container=>{container.replaceChildren();if(!targets.length){container.append(node('p','No outbound webhooks configured.','muted'));return}for(const target of targets){const el=node('div',undefined,'routine');el.append(node('strong',target.url),node('p',target.topics.join(', '),'muted'));const latest=history.find(item=>item.targetId===target.id);if(latest)el.append(node('p','Latest delivery: '+latest.status+' · attempt '+latest.attempt+(latest.responseStatus?' · HTTP '+latest.responseStatus:''),'muted'));const actions=node('div',undefined,'actions');actions.append(button(target.enabled?'Pause webhook':'Enable webhook',()=>api('/api/bots/'+selected+'/deliveries/'+target.id+'/enabled',{enabled:!target.enabled})));if(latest?.status==='failed')actions.append(button('Retry latest delivery',()=>api('/api/bots/'+selected+'/deliveries/'+latest.id+'/retry',{})));actions.append(button('Remove webhook',async()=>{if(!window.confirm('Remove this receiver and its pending delivery queue?'))return;await api('/api/bots/'+selected+'/deliveries/'+target.id+'/delete',{})},'danger'));el.append(actions);const key=node('details');key.append(node('summary','Receiver verification key'),node('p','Configure this public key at the receiver. Verify the signature over timestamp + "." + the exact request body. Reject old timestamps and deduplicate by delivery ID.','muted'),node('pre',target.publicKey));if(latest?.lastError)key.append(node('p',latest.lastError,'error'));el.append(key);container.append(el)}})}
function showGroups(groups){groupsState=groups;syncMobileTabs();update('group-list',{groups,selectedGroup,drafts:[...groupDrafts.keys()].sort(),appearance:botsState.map(bot=>({id:bot.id,appearance:bot.appearance,state:podState(bot)}))},container=>{container.replaceChildren();for(const group of groups){const hasDraft=groupDrafts.has(group.id),el=button('',async()=>selectGroup(group.id));const team=node('span',undefined,'group-faces');for(const member of group.members.slice(0,3)){const bot=botsState.find(bot=>bot.id===member.botId)||member;team.append(avatar(bot,'reply-avatar',podState(bot)))}el.setAttribute('aria-label','Open '+group.name+' group chat'+(hasDraft?', unsent task draft':''));el.append(team,node('span',group.name));if(hasDraft)el.append(node('span','Draft','conversation-draft'));el.className='bot'+(selectedGroup===group.id?' selected':'');container.append(el)}if(!groups.length)container.append(node('p','Create a room to coordinate agents.','muted'))})}
function populateGroupRecipients(group){const container=$('group-recipients');container.replaceChildren();for(const member of group.members){const label=node('label',member.name);const input=node('input');input.type='checkbox';input.name='recipients';input.value=member.botId;input.checked=member.enabled;input.disabled=!member.enabled;label.className='member-choice';label.prepend(input,avatar(botsState.find(bot=>bot.id===member.botId)||member,'reply-avatar'));container.append(label)}}
function renderGroupEmptyState(container){
  const welcome=node('section',undefined,'group-welcome'),starters=node('div',undefined,'group-starters');
  welcome.append(node('h2','Start your first group task'),node('p','Choose a prompt to draft a shared task for your teammates.','group-welcome-copy'));
  starters.setAttribute('role','group');starters.setAttribute('aria-label','Suggested group tasks');
  for(const [title,detail,prompt] of GROUP_TASK_STARTERS){const choice=button('',()=>{const message=$('group-message-form').elements.message;message.value=prompt;message.dispatchEvent(new Event('input',{bubbles:true}));message.focus();message.setSelectionRange(prompt.length,prompt.length)},'group-starter');choice.setAttribute('aria-label',title+'. '+detail);choice.append(node('strong',title),node('span',detail));starters.append(choice)}
  welcome.append(starters,node('p','These are editable drafts. Nothing is sent until you choose recipients and submit.','group-welcome-note'));container.append(welcome)
}
async function selectGroup(id){
  $('agent-more').open=false;mobilePodsPage=false;overviewMode=false;$('overview-link').setAttribute('aria-current','false');document.querySelector('.workspace').dataset.overview='false';
  if(selected){rememberCurrentDraft();rememberActiveConversation()}
  closeDialogs();selected=null;selectedConversation=null;newConversationDraft=false;current=null;selectedGroup=id;syncMobileTabs();$('new-conversation').hidden=true;$('new-conversation-main').hidden=true;$('pod-settings').hidden=true;showConversations([]);reviewOpen=false;setReviewOpen(false);syncGroupWorkspace();
  groupMessageKey=null;signatures.delete('group-transcript');signatures.delete('group-artifacts');$('group-message-form').reset();$('group-message-form').dataset.groupId='';$('group-message-form').querySelector('.error').textContent='';$('group-artifacts').hidden=true;$('group-library').setAttribute('aria-expanded','false');await refreshGroup(id);restoreGroupDraft(id);showBots(botsState)
}
async function startGroupTask(id){await selectGroup(id);const field=$('group-message-form').elements.message;field.focus();field.setSelectionRange(field.value.length,field.value.length)}
async function refreshGroup(id){const epoch=authEpoch,data=await api('/api/groups/'+encodeURIComponent(id));if(selectedGroup!==id||epoch!==authEpoch)return;const group=data.group;$('group-title').textContent=group.name;$('group-members-edit').textContent='Members · '+group.members.length;$('group-description').textContent='Members: '+group.members.map(member=>member.name).join(', ')+(group.shareBrowser?' · shared Codimium browser, queued one task at a time':' · private browser profiles');populateGroupRecipientsIfNeeded(group);const memberNames=new Map(group.members.map(member=>[member.botId,member.name]));update('group-transcript',{messages:data.messages,runs:data.runs,appearance:botsState.map(bot=>({id:bot.id,appearance:bot.appearance,enabled:bot.enabled}))},container=>{const bottom=container.scrollHeight-container.scrollTop-container.clientHeight<80,scroll=container.scrollTop;container.replaceChildren();if(!data.messages.length)renderGroupEmptyState(container);for(const message of data.messages){const entry=node('div',undefined,'group-message'),sender=message.sender==='user'?'You':memberNames.get(message.botId)||'Former member';if(message.sender!=='user'){const bot=botsState.find(bot=>bot.id===message.botId)||{name:sender};entry.append(avatar(bot,'reply-avatar',podState(bot)))}const content=node('div',undefined,'group-message-content');content.append(node('strong',sender),node('time',date(message.createdAt)),message.sender==='user'?node('p',message.content):renderPodIntelligentAnswer(message.content));entry.append(content);if(message.sender==='user'){const runs=data.runs.filter(run=>run.groupMessageId===message.id);if(runs.length){const statuses=node('div',undefined,'group-members');for(const run of runs){const member=group.members.find(item=>item.botId===run.botId);statuses.append(node('span',(member?.name||'Agent')+': '+runStatusLabel(run.status),'muted'));if(['blocked','failed'].includes(run.status))statuses.append(button('Review '+(member?.name||'agent'),async()=>{selectBot(run.botId);await refresh()}))}content.append(statuses)}}container.append(entry)}container.scrollTop=bottom?container.scrollHeight:scroll});update('group-artifacts',data.artifacts,container=>{container.replaceChildren();if(!data.artifacts.length)container.append(node('p','Files your teammates share will appear here.','muted'));for(const artifact of data.artifacts){const details=node('details'),summary=node('summary',artifact.name+' · v'+artifact.version);details.append(summary,node('p','Updated '+date(artifact.updatedAt),'muted'));let loaded=false;details.addEventListener('toggle',async()=>{if(!details.open||loaded)return;loaded=true;try{const value=await api('/api/groups/'+encodeURIComponent(id)+'/artifacts/'+encodeURIComponent(artifact.name));if(details.isConnected)details.append(node('pre',value.content),button('Download file',()=>downloadText(artifact.name,value.content)))}catch(error){loaded=false;if(details.isConnected)details.append(node('p',error.message,'error'))}});container.append(details)}})}
function populateGroupRecipientsIfNeeded(group){const form=$('group-message-form');const signature=JSON.stringify(group.members);if(form.dataset.groupId===group.id&&form.dataset.members===signature)return;const chosen=new Set([...form.querySelectorAll('input:checked')].map(input=>input.value)),same=form.dataset.groupId===group.id;form.dataset.groupId=group.id;form.dataset.members=signature;populateGroupRecipients(group);if(same)for(const input of form.querySelectorAll('input'))input.checked=chosen.has(input.value)&&!input.disabled}
function updateGroupMembersEditor(){const form=$('group-members-form'),options=$('group-members-options'),selected=[...options.querySelectorAll('input:checked')].map(input=>input.value),original=new Set(JSON.parse(form.dataset.originalMembers||'[]')),changed=selected.length!==original.size||selected.some(id=>!original.has(id));$('group-members-save').disabled=selected.length<2||selected.length>16||!changed;$('group-members-status').textContent=selected.length<2?'Select at least two Pods.':selected.length>16?'Groups can have up to 16 Pods.':changed?selected.length+' selected. Save to update this group.':selected.length+' selected. Add or remove a Pod to change the group.';for(const input of options.querySelectorAll('input:not(:checked)'))input.disabled=selected.length>=16}
async function openGroupMembersEditor(){const id=selectedGroup;if(!id)return;const data=await api('/api/groups/'+encodeURIComponent(id));if(id!==selectedGroup)return;const group=data.group,form=$('group-members-form'),options=$('group-members-options'),current=new Set(group.members.map(member=>member.botId));options.replaceChildren();for(const bot of botsState.filter(item=>item.enabled||current.has(item.id))){const input=document.createElement('input'),copy=node('span',undefined,'group-member-copy'),label=node('label',undefined,'group-member-option');input.type='checkbox';input.name='botIds';input.value=bot.id;input.checked=current.has(bot.id);copy.append(node('strong',bot.name),node('span',!bot.enabled?'Paused · current member':input.checked?'Current member':'Available to add'));label.append(input,copy);options.append(label)}form.dataset.groupId=id;form.dataset.originalMembers=JSON.stringify([...current].sort());form.querySelector('.error').textContent='';updateGroupMembersEditor();$('group-members-dialog').showModal();$('group-members-save').focus()}
async function refreshGroups(epoch){const data=await api('/api/groups');if(epoch!==authEpoch)return;const groupIds=new Set(data.groups.map(group=>group.id));let removedDraft=false;for(const id of groupDrafts.keys())if(!groupIds.has(id)){groupDrafts.delete(id);removedDraft=true}if(removedDraft)scheduleDraftPersistence();showGroups(data.groups);notifyDraftRecovery();if(!selectedGroup)return;if(!groupIds.has(selectedGroup)){selectedGroup=null;syncGroupWorkspace();signatures.delete('group-transcript');signatures.delete('group-artifacts');return}await refreshGroup(selectedGroup)}
function openNote(note){noteEdit=note||null;const form=$('note-form');form.reset();form.querySelector('.error').textContent='';form.elements.content.value=note?.content||'';form.elements.source.value=note?.source||'user:panel';form.elements.expiresAt.value=note?.expiresAt===null||!note?'':new Date(note.expiresAt-new Date(note.expiresAt).getTimezoneOffset()*60000).toISOString().slice(0,-1);$('remove-note').hidden=!note;$('note-dialog').showModal()}
async function refresh(){if(refreshing)return;refreshing=true;try{const epoch=authEpoch,includeRecent=overviewMode,includeGroupActivity=overviewMode||(mobilePodsPage&&mobilePodsView==='groups'),query=[includeRecent?'includeRecent=1':'',includeGroupActivity?'includeGroupActivity=1':''].filter(Boolean).join('&'),state=await api('/api/bots'+(query?'?'+query:''));if(epoch!==authEpoch)return;if(includeGroupActivity)mobileGroupRuns=state.activeGroupRuns||[];authenticated=true;$('login').hidden=true;$('app').hidden=false;$('connection').textContent='Connected';$('connection').dataset.state='online';if(!mobilePodsPage&&!selectedGroup&&!state.bots.some(b=>b.id===selected)){if(overviewMode){selected=null;current=null}else{const next=state.bots[0]?.id||null;if(next!==selected)selectBot(next)}}showBots(state.bots);await refreshGroups(epoch);if(epoch!==authEpoch)return;if(selectedGroup){setReviewOpen(false);syncGroupWorkspace();return}if(mobilePodsPage){setReviewOpen(false);renderMobilePodsPage(state.bots);return}if(overviewMode){$('composer').hidden=true;$('new-conversation').hidden=true;$('new-conversation-main').hidden=true;$('pod-settings').hidden=true;$('toggle-bot').hidden=true;$('new-routine').hidden=true;$('export-bot').hidden=true;$('delete-bot').hidden=true;$('new-delivery').hidden=true;$('history-section').hidden=true;browserOpen.hidden=true;$('new-note').hidden=true;if(state.bots.length)showOverview(state.bots,state.recentRuns||[],state.activeRuns||[],mobileGroupRuns);else showNoAgents();return}$('composer').hidden=!selected;$('new-conversation').hidden=!selected;$('new-conversation-main').hidden=!selected;$('pod-settings').hidden=!selected;$('toggle-bot').hidden=!selected;$('new-routine').hidden=!selected;$('export-bot').hidden=!selected;$('delete-bot').hidden=!selected;$('new-delivery').hidden=!selected;$('history-section').hidden=!selected;browserOpen.hidden=!selected;$('new-note').hidden=!selected;if(!selected){showNoAgents();return}const id=selected;const data=await api('/api/bots/'+id);if(id!==selected||epoch!==authEpoch)return;current=data;if(!newConversationDraft&&!data.conversations.some(conversation=>conversation.id===selectedConversation)){const conversationId=data.conversations[0]?.id||null;setConversationContext(conversationId,false);restoreDraft(id,conversationId)}showConversations(data.conversations);markSeen(state.bots.find(bot=>bot.id===id)||data.bot);showBots(state.bots);showLibrary(data.runs);$('bot-name').textContent=data.bot.name;const agentState=podState(data.bot,data.runs);setAvatar($('bot-avatar'),data.bot,agentState);$('agent-state').textContent=agentState;$('agent-state').dataset.state=agentState;$('responsibility').textContent=data.bot.instructions;const projectRoot=data.bot.projectRoot||'';$('project-context').hidden=!projectRoot;$('project-root-path').textContent=projectRoot;$('project-root-path').title=projectRoot;$('toggle-bot').textContent=data.bot.enabled?'Pause new work':'Enable agent';const events = await api('/api/bots/'+id+'/events?after='+eventCursor);if(id!==selected||epoch!==authEpoch)return;if(events.length){eventCursor=events.at(-1).event_seq;eventItems.push(...events);eventItems=eventItems.slice(-80);indexActivity(events)}showRuns(selectedConversation?data.runs.filter(run=>run.conversationId===selectedConversation):[],data.unreconciledRuns,data.guidance,newConversationDraft||selectedConversation?null:data.legacyTranscript);showDecisions(data.decisions);showRoutines(data.routines);showNotes(data.notes);showProcedures(data.procedures);const deliveryData=await api('/api/bots/'+id+'/deliveries');if(id!==selected||epoch!==authEpoch)return;showDeliveries(deliveryData.targets,deliveryData.history);if(eventItems.length)showEventList();}catch(error){if(authenticated){$('connection').textContent='Connection interrupted';$('connection').dataset.state='offline';notify(error.message+' Your queued tasks remain saved.')}}finally{refreshing=false}}
$('history-search-form').addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget,control=submitter(event),query=String(new FormData(form).get('query')||'').trim(),botId=selected,epoch=authEpoch;control.disabled=true;form.querySelector('.error').textContent='';try{if(!botId)throw new Error('Select an agent first');const results=await api('/api/bots/'+encodeURIComponent(botId)+'/history?query='+encodeURIComponent(query));if(botId===selected&&epoch===authEpoch)showHistory(results)}catch(error){form.querySelector('.error').textContent=error.message}finally{control.disabled=false}});
$('workspace-history-form').addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget,query=String(new FormData(form).get('query')||'').trim(),control=form.querySelector('button[type=submit]'),request=++workspaceHistoryRequest,dialog=$('workspace-history-dialog');control.disabled=true;$('workspace-history-status').textContent='Searching all Pod history…';$('workspace-history-results').replaceChildren();try{if(query.length<2)throw new Error('Enter at least two characters to search task history');const results=await api('/api/history?query='+encodeURIComponent(query)+'&limit=20');if(request!==workspaceHistoryRequest||!dialog.open)return;if(!results.length){$('workspace-history-status').textContent='No matching finished tasks across your Pods.';return}showWorkspaceHistory(results)}catch(error){if(request===workspaceHistoryRequest&&dialog.open)$('workspace-history-status').textContent=error.message}finally{if(request===workspaceHistoryRequest)control.disabled=false}});
$('token-visibility').addEventListener('click',()=>setLoginTokenVisible($('token').type==='password'));
$('login-form').addEventListener('submit',async event=>{event.preventDefault();const submit=submitter(event);submit.disabled=true;try{await api('/api/login',{token:$('token').value});$('token').value='';setLoginTokenVisible(false);$('login-error').textContent='';await refresh()}catch(error){$('login-error').textContent=error.message}finally{submit.disabled=false}});
$('logout').addEventListener('click',async()=>{try{await api('/api/logout',{});signOut();discardDraftState();notify('')}catch(error){notify(error.message)}});

for(const tab of document.querySelectorAll('[data-workspace-view]'))tab.addEventListener('click',()=>setReviewOpen(tab.dataset.workspaceView!=='conversation',tab.dataset.workspaceView==='conversation'?'activity':tab.dataset.workspaceView));
$('pod-search').addEventListener('input',()=>showBots(botsState));
$('theme-toggle').addEventListener('click',()=>{const light=document.documentElement.dataset.theme!=='light';document.documentElement.dataset.theme=light?'light':'dark';$('theme-toggle').textContent=light?'Dark':'Light';$('theme-toggle').setAttribute('aria-label','Switch to '+(light?'dark':'light')+' theme')});
$('close-review').addEventListener('click',()=>{setReviewOpen(false);document.querySelector('[data-workspace-view=conversation]').focus()});
$('mobile-workspace-view').addEventListener('change',event=>{const view=event.currentTarget.value;setReviewOpen(view!=='conversation',view==='conversation'?'activity':view)});
$('new-conversation').addEventListener('click',startNewConversation);
$('new-conversation-main').addEventListener('click',startNewConversation);$('mobile-new-conversation').addEventListener('click',startNewConversation);$('mobile-conversation-trigger').addEventListener('click',openMobileConversationPicker);$('mobile-conversations-search').addEventListener('input',()=>renderMobileConversationPicker());$('mobile-conversations-new').addEventListener('click',()=>{$('mobile-conversations-dialog').close();startNewConversation()});
$('copy-project-root').addEventListener('click',async()=>{const path=current?.bot.projectRoot;if(!path)return;try{await navigator.clipboard.writeText(path);notify('Project folder path copied to clipboard.')}catch{window.prompt('Clipboard access is unavailable. Copy this project folder path:',path)}});
$('pod-settings').addEventListener('click',()=>openSettings());
$('settings-scope').addEventListener('change',event=>loadPodSettings(event.currentTarget.value).catch(error=>notify(error.message)));

function openCreateGroup(){const form=$('group-create-form'),container=$('group-create-members');form.reset();form.querySelector('.error').textContent='';container.replaceChildren();for(const bot of botsState.filter(item=>item.enabled)){const label=node('label',bot.name);const input=node('input');input.type='checkbox';input.name='botIds';input.value=bot.id;label.prepend(input);container.append(label)}if(container.childElementCount<2)container.append(node('p','Enable at least two agents before creating a group.','muted'));$('group-create-dialog').showModal()}
$('new-group').addEventListener('click',openCreateGroup);
$('group-create-form').addEventListener('submit',event=>submitForm(event,async fields=>{const group=await api('/api/groups',{name:fields.get('name'),botIds:fields.getAll('botIds'),shareBrowser:fields.get('shareBrowser')==='on'});await selectGroup(group.id)}));
$('group-members-options').addEventListener('change',updateGroupMembersEditor);
$('group-members-form').addEventListener('submit',event=>submitForm(event,async fields=>{const form=event.currentTarget,id=form.dataset.groupId;if(!id||id!==selectedGroup)throw new Error('Open a group before changing its members');await api('/api/groups/'+encodeURIComponent(id)+'/members',{botIds:fields.getAll('botIds')});$('group-message-form').dataset.groupId='';await refreshGroup(id);notify('Group members updated. Messages, artifacts and task history are preserved.')}));
$('group-message-form').addEventListener('input',()=>{groupMessageKey=null;saveGroupDraft(selectedGroup)});
$('group-message-form').addEventListener('submit',event=>submitForm(event,async fields=>{if(!selectedGroup)throw new Error('Select a collaboration group first');groupMessageKey??=crypto.randomUUID();const id=selectedGroup,message=fields.get('message');saveGroupDraft(id);await api('/api/groups/'+encodeURIComponent(id)+'/messages',{message,messageId:groupMessageKey,recipients:fields.getAll('recipients')});if(groupDrafts.get(id)?.message===message){groupDrafts.delete(id);scheduleDraftPersistence();showGroups(groupsState)}if(selectedGroup===id){if($('group-message-form').elements.message.value===message)$('group-message-form').elements.message.value='';groupMessageKey=null}}));
$('delete-group').addEventListener('click',event=>perform(event.currentTarget,async()=>{if(!selectedGroup)return;const id=selectedGroup,group=await api('/api/groups/'+encodeURIComponent(id));if(selectedGroup!==id)return;openDeleteConfirmation('Delete group','This permanently deletes '+group.group.name+', including its shared messages, artifacts and group browser profile.',group.group.name,async()=>{await api('/api/groups/'+encodeURIComponent(id)+'/delete',{confirmation:group.group.name});if(selectedGroup===id){selectedGroup=null;syncGroupWorkspace();signatures.delete('group-list')}},'Delete group')}));
const toneColors=${JSON.stringify(POD_TONE_COLORS)};
const appearanceLabels={'cap':'Beret','bucket-hat':'Bucket hat','bowtie':'Bow tie'};
const createTemplates={builder:{label:'Builder',name:'builder',instructions:'Inspect the project conventions, implement focused features and fixes, then verify the result with relevant checks. Summarize what changed and any limitations.',firstTask:'Inspect this project, identify one small high-value improvement, implement it, and run the relevant checks. Summarize the change and any limitations.'},reviewer:{label:'Reviewer',name:'reviewer',instructions:'Review code changes for correctness, security and regressions. Verify findings in context and report only actionable issues with file and line references.',firstTask:'Review this project for concrete correctness or security issues. Report only verified findings with file and line references; do not edit files.'},tester:{label:'Tester',name:'tester',instructions:'Add useful tests for important behavior and edge cases. Follow the project test conventions and report what ran and any failures.',firstTask:'Inspect the existing tests, add one focused test for an important uncovered behavior, and run the relevant checks. Explain what the test verifies.'},documenter:{label:'Docs',name:'documenter',instructions:'Keep the project documentation accurate and useful. Check the implementation, make focused updates, and report which docs changed.',firstTask:'Compare this project’s documentation with its implementation, correct one concrete mismatch, and summarize the documentation change.'}};
function appearanceFields(container,prefix){
  for(const [key,choices] of Object.entries(appearanceOptions)){
    const field=node('fieldset',undefined,'appearance-options options-'+key);field.append(node('legend',key==='tone'?'Color':key[0].toUpperCase()+key.slice(1)));
    const grid=node('div',undefined,'choice-grid');
    for(const [index,choice] of choices.entries()){
      const title=appearanceLabels[choice]||choice[0].toUpperCase()+choice.slice(1),label=node('label',undefined,'appearance-choice');
      const input=node('input');input.type='radio';input.name=prefix+key;input.value=choice;input.checked=index===0;input.defaultChecked=index===0;
      label.title=title;label.append(input);
      if(key==='tone'){
        const swatch=node('span',undefined,'color-swatch');swatch.style.backgroundColor=toneColors[choice];swatch.setAttribute('aria-hidden','true');label.append(swatch);
      }else if(key==='shape'||key==='accessory'){
        const miniature=node('span',undefined,'choice-avatar');
        setAvatar(miniature,{appearance:{shape:key==='shape'?choice:'circle',tone:'cream',eyes:'round',accessory:key==='accessory'?choice:'none'}},'ready',true);
        miniature.setAttribute('aria-hidden','true');miniature.querySelector('canvas').removeAttribute('tabindex');label.append(miniature);
      }
      label.append(node('span',title,'choice-name'));grid.append(label);
    }
    field.append(grid);container.append(field);
  }
}
function formAppearance(form,prefix=''){return Object.fromEntries(Object.keys(appearanceOptions).map(key=>[key,form.elements.namedItem(prefix+key).value]))}
function previewAppearance(id,form,name,prefix=''){
  const container=$(id);let character=container.querySelector('.editor-avatar');
  if(!character){character=node('span',undefined,'editor-avatar');const caption=node('div',undefined,'preview-caption');caption.append(node('p',name||'Your new Pod'),node('span','Drag to look around · arrow keys work too','muted'),button('Reset view',()=>window.Pod3D.reset(character)));container.replaceChildren(character,caption)}
  container.querySelector('p').textContent=name||'Your new Pod';
  setAvatar(character,{name,appearance:formAppearance(form,prefix)},'ready',true);
}
appearanceFields($('appearance-fields'),'');
appearanceFields($('create-appearance-fields'),'appearance:');
const createLooks=[{name:'Calm',detail:'Cloud · blue',shape:'cloud',tone:'blue',eyes:'round',accessory:'none'},{name:'Curious',detail:'Clover · mint',shape:'clover',tone:'mint',eyes:'curious',accessory:'glasses'},{name:'Focused',detail:'Square · lilac',shape:'square',tone:'lilac',eyes:'round',accessory:'glasses'},{name:'Bright',detail:'Star · amber',shape:'star',tone:'amber',eyes:'happy',accessory:'headphones'}];
for(const look of createLooks){const choice=node('button',undefined,'create-look'),swatch=node('span',undefined,'create-look-swatch');choice.type='button';choice.setAttribute('aria-pressed','false');swatch.style.backgroundColor=toneColors[look.tone];swatch.setAttribute('aria-hidden','true');choice.append(swatch,node('strong',look.name),node('span',look.detail,'create-look-detail'));choice.addEventListener('click',()=>{const form=$('create-form');for(const key of Object.keys(appearanceOptions))form.elements.namedItem('appearance:'+key).value=look[key];form.querySelector('input[name="appearance:tone"]:checked').dispatchEvent(new Event('input',{bubbles:true}));for(const button of $('create-look-presets').querySelectorAll('button'))button.setAttribute('aria-pressed',String(button===choice))});$('create-look-presets').append(choice)}
function openProjectFolderPicker(){if(!$('create-dialog').open||$('folder-picker-dialog').open)return;$('folder-picker-search').value='';$('folder-picker-hidden').checked=false;$('folder-picker-path').textContent='Loading your home folder…';$('folder-picker-dialog').showModal();$('folder-picker-search').focus();void loadProjectFolders()}
async function loadProjectFolders(path){const request=++folderPickerRequest,dialog=$('folder-picker-dialog');$('folder-picker-results').replaceChildren();$('folder-picker-status').textContent='Loading folders…';$('folder-picker-select').disabled=true;$('folder-picker-up').disabled=true;try{const result=await api('/api/directories'+(path?'?path='+encodeURIComponent(path):''));if(request!==folderPickerRequest||!dialog.open)return;folderPickerPath=result.path;folderPickerParent=result.parent;folderPickerDirectories=result.directories;$('folder-picker-path').textContent=folderPickerPath;$('folder-picker-select').disabled=false;$('folder-picker-up').disabled=!folderPickerParent;renderProjectFolderEntries()}catch(error){if(request!==folderPickerRequest||!dialog.open)return;$('folder-picker-status').textContent=error.message}}
function renderProjectFolderEntries(){const container=$('folder-picker-results'),query=$('folder-picker-search').value.trim().toLowerCase(),showHidden=$('folder-picker-hidden').checked,visible=folderPickerDirectories.filter(directory=>(showHidden||!directory.name.startsWith('.'))&&directory.name.toLowerCase().includes(query));container.setAttribute('aria-label','Folders in '+folderPickerPath);container.replaceChildren();for(const directory of visible){const entry=button('',()=>void loadProjectFolders(directory.path));entry.className='folder-picker-entry';entry.setAttribute('aria-label','Open folder '+directory.name);entry.append(node('span',directory.name,'folder-picker-name'),node('span','›','folder-picker-arrow'));container.append(entry)}$('folder-picker-status').textContent=query?visible.length+' matching '+(visible.length===1?'folder':'folders')+'.':visible.length?visible.length+' folders here. Select one to open it.':'No subfolders here. You can still use this folder.'}
function syncProjectFolderSuggestions(){const roots=new Map();for(const pod of botsState){if(!pod.projectRoot)continue;const names=roots.get(pod.projectRoot)||[];names.push(pod.name);roots.set(pod.projectRoot,names)}const container=$('project-folder-options');container.replaceChildren();for(const [path,names] of roots){const choice=document.createElement('button');choice.type='button';choice.className='project-folder-option';choice.setAttribute('aria-label','Use '+names.join(', ')+' project folder '+path);choice.append(node('strong',names.join(', '),'project-folder-option-name'),node('code',path,'project-folder-option-path'));choice.addEventListener('click',()=>{const input=$('create-form').elements.projectRoot;input.value=path;input.dispatchEvent(new Event('input',{bubbles:true}));$('project-folder-status').textContent='Project folder copied from '+names.join(', ')+'.';$('project-folder-status').hidden=false;$('project-folder-reuse').open=false;$('project-folder-reuse').querySelector('summary').focus()});container.append(choice)}$('project-folder-reuse').hidden=!roots.size;$('project-folder-status').hidden=true;$('project-folder-status').textContent=''}
function openCreate(){const form=$('create-form');form.reset();form.scrollTop=0;createDraftFresh.hidden=true;$('create-appearance').open=false;document.querySelectorAll('#create-look-presets button').forEach(button=>button.setAttribute('aria-pressed','false'));form.elements.firstTask.dataset.starterSuggestion='';$('create-first-task').open=true;$('create-submit').textContent='Create Pod';form.querySelector('.error').textContent='';syncProjectFolderSuggestions();setCreateTemplateChoice('','Choose a role to prefill editable details.');const defaults=defaultAppearance('Pod');for(const [key,value] of Object.entries(defaults))form.elements.namedItem('appearance:'+key).value=value;const restored=restoreCreateDraft();if(restored)form.elements.name.dispatchEvent(new Event('input',{bubbles:true}));previewAppearance('create-avatar-preview',form,'Your new Pod','appearance:');window.Pod3D.reset($('create-avatar-preview').querySelector('.editor-avatar'));$('create-dialog').showModal()}
function openCreateFromCurrent(){const source=current?.bot;if(!source)return;discardCreateDraft();openCreate();const form=$('create-form'),firstTask=form.elements.firstTask;form.elements.name.value=source.name.slice(0,59)+'-copy';form.elements.projectRoot.value=source.projectRoot;form.elements.instructions.value=source.instructions;form.elements.agentConfig.value=source.agentConfig||'';form.elements.reviewerModel.value=source.reviewerModel||'';firstTask.value='';firstTask.dataset.starterSuggestion='';$('create-first-task').open=false;for(const [key,value] of Object.entries(podAppearance(source)))form.elements.namedItem('appearance:'+key).value=value;$('pod-template-status').textContent='Settings copied from '+source.name+'. The new Pod starts enabled with fresh conversations, task history and agent state.';form.elements.name.dispatchEvent(new Event('input',{bubbles:true}))}
$('create-similar-pod').addEventListener('click',()=>{$('agent-more').open=false;openCreateFromCurrent()});
$('browse-project-folder').addEventListener('click',openProjectFolderPicker);$('folder-picker-up').addEventListener('click',()=>{if(folderPickerParent)void loadProjectFolders(folderPickerParent)});$('folder-picker-search').addEventListener('input',renderProjectFolderEntries);$('folder-picker-hidden').addEventListener('change',renderProjectFolderEntries);$('folder-picker-select').addEventListener('click',()=>{const input=$('create-form').elements.projectRoot;input.value=folderPickerPath;input.dispatchEvent(new Event('input',{bubbles:true}));$('project-folder-status').textContent='Project folder selected.';$('project-folder-status').hidden=false;$('folder-picker-dialog').close()});$('folder-picker-dialog').addEventListener('close',()=>{folderPickerRequest++;folderPickerDirectories=[]});$('mobile-pods-tab').addEventListener('click',()=>openMobilePodsPage('pods'));$('mobile-chats-tab').addEventListener('click',()=>openMobilePodsPage('chats'));$('mobile-pods-search').addEventListener('input',()=>mobilePodsView==='chats'?searchMobileChats():renderMobilePodsPage());$('mobile-workspace-switch').addEventListener('click',event=>{const view=event.target.closest('[data-mobile-workspace-view]');if(view)selectMobileWorkspaceView(view.dataset.mobileWorkspaceView)});$('mobile-pods-filters').addEventListener('click',event=>{const filter=event.target.closest('[data-pods-filter]');if(filter){selectMobilePodsFilter(filter.dataset.podsFilter);renderMobilePodsPage()}});$('mobile-pods-create').addEventListener('click',()=>{if(mobilePodsView==='chats')openAssignTask();else if(mobilePodsView==='groups')openCreateGroup();else openCreate()});$('mobile-jump-tab').addEventListener('click',openQuickOpen);$('mobile-history-tab').addEventListener('click',openWorkspaceHistory);$('mobile-overview-tab').addEventListener('click',()=>{$('overview-link').click();$('mobile-overview-tab').focus()});$('quick-open-trigger').addEventListener('click',openQuickOpen);$('quick-open-close').addEventListener('click',()=>$('quick-open-dialog').close());$('quick-open-dialog').addEventListener('close',()=>{quickOpenConversationRequest++;clearTimeout(quickOpenConversationTimer);quickOpenSearchingConversations=false;workspaceConversationResults=[]});$('quick-open-search').addEventListener('input',()=>{quickOpenSelection=0;searchWorkspaceConversations($('quick-open-search').value.trim())});$('quick-open-search').addEventListener('keydown',event=>{if(!quickOpenMatches.length)return;if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();quickOpenSelection=(quickOpenSelection+(event.key==='ArrowDown'?1:-1)+quickOpenMatches.length)%quickOpenMatches.length;renderQuickOpen();$('quick-open-results').children[quickOpenSelection]?.scrollIntoView({block:'nearest'})}else if(event.key==='Enter'){event.preventDefault();const item=quickOpenMatches[quickOpenSelection];$('quick-open-dialog').close();item.run()}});document.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();openQuickOpen()}});
document.addEventListener('pointerdown',event=>{const more=$('agent-more');if(more.open&&!more.contains(event.target))more.open=false});
document.addEventListener('keydown',event=>{const more=$('agent-more');if(event.key==='Escape'&&more.open){more.open=false;more.querySelector('summary').focus()}});
$('agent-more').addEventListener('click',event=>{if(event.target.closest('button'))$('agent-more').open=false});
$('overview-link').addEventListener('click',()=>{mobilePodsPage=false;overviewMode=true;overviewFilter='all';if(selectedGroup)saveGroupDraft(selectedGroup);selectedGroup=null;syncMobileTabs();syncGroupWorkspace();setReviewOpen(false);signatures.delete('feed');void refresh()});
$('new-bot').addEventListener('click',()=>{openCreate()});
$('create-form').addEventListener('input',event=>{if(event.target.name?.startsWith('appearance:'))document.querySelectorAll('#create-look-presets button').forEach(button=>button.setAttribute('aria-pressed','false'));const form=$('create-form');previewAppearance('create-avatar-preview',form,form.elements.name.value||'Your new Pod','appearance:');$('create-submit').textContent=form.elements.firstTask.value.trim()?'Create & start task':'Create Pod';persistCreateDraft()});
$('create-form').elements.projectRoot.addEventListener('input',()=>{$('project-folder-status').hidden=true});
const templateGrid=$('pod-templates').querySelector('.pod-template-grid'),templateSelection=node('div',undefined,'pod-template-selection'),templateSelectionLabel=node('strong',undefined,'pod-template-selection-label');
templateSelection.id='pod-template-selection';templateSelection.setAttribute('role','group');templateSelection.setAttribute('aria-label','Selected starting role');templateSelection.append(templateSelectionLabel,button('Change role',()=>{setCreateTemplateChoice('','Choose a role to prefill editable details.');templateGrid.querySelector('button')?.focus({preventScroll:true});persistCreateDraft()}));templateSelection.hidden=true;templateGrid.after(templateSelection);
function setCreateTemplateChoice(label,status){templateGrid.hidden=Boolean(label);templateSelection.hidden=!label;if(label)templateSelectionLabel.textContent=label+' starter';$('pod-template-status').textContent=status}
const createDraftFresh=button('Start fresh',()=>{discardCreateDraft();$('create-dialog').close();openCreate()});createDraftFresh.id='create-draft-fresh';createDraftFresh.className='create-draft-fresh';createDraftFresh.setAttribute('aria-label','Discard the saved setup and start fresh');createDraftFresh.hidden=true;$('pod-template-status').after(createDraftFresh);
function createFormFieldNames(){return ['name','projectRoot','instructions','firstTask','agentConfig','reviewerModel',...Object.keys(appearanceOptions).map(key=>'appearance:'+key)]}
function persistCreateDraft(){
  if(!$('create-dialog').open)return
  if(!authenticated){discardCreateDraft();return}
  const form=$('create-form'),names=createFormFieldNames(),values=Object.fromEntries(names.map(name=>[name,form.elements.namedItem(name)?.value||''])),defaults=defaultAppearance('Pod');
  if(!['name','projectRoot','instructions','firstTask','agentConfig','reviewerModel'].some(name=>String(values[name]).trim())&&!Object.entries(defaults).some(([key,value])=>values['appearance:'+key]!==value)){discardCreateDraft();return}
  try{sessionStorage.setItem(createDraftStorageKey,JSON.stringify({version:1,values,templateLabel:templateSelection.hidden?'':templateSelectionLabel.textContent.replace(/ starter$/,''),starterSuggestion:form.elements.firstTask.dataset.starterSuggestion||'',firstTaskOpen:$('create-first-task').open,appearanceOpen:$('create-appearance').open}));createDraftWarning=false}catch{if(authenticated&&!createDraftWarning){createDraftWarning=true;notify('Browser storage is unavailable. Your Pod setup will stay only until this page closes.')}}
}
function restoreCreateDraft(){
  let saved;try{saved=JSON.parse(sessionStorage.getItem(createDraftStorageKey)||'null')}catch{discardCreateDraft();return false}
  if(!saved)return false;if(saved.version!==1||!saved.values||typeof saved.values!=='object'||Array.isArray(saved.values)){discardCreateDraft();return false}
  const form=$('create-form');for(const name of createFormFieldNames()){const value=saved.values[name],control=form.elements.namedItem(name),max=name==='name'?64:name==='projectRoot'?4096:name==='reviewerModel'?128:name.startsWith('appearance:')?32:100000;if(typeof value==='string'&&value.length<=max&&control)control.value=value}
  if(typeof saved.starterSuggestion==='string'&&saved.starterSuggestion.length<=100000)form.elements.firstTask.dataset.starterSuggestion=saved.starterSuggestion;
  $('create-first-task').open=saved.firstTaskOpen!==false;$('create-appearance').open=saved.appearanceOpen===true;
  const labels=Object.values(createTemplates).map(template=>template.label),label=typeof saved.templateLabel==='string'&&labels.includes(saved.templateLabel)?saved.templateLabel:'';setCreateTemplateChoice(label,'Unfinished Pod setup restored from this tab.');createDraftFresh.hidden=false;return true
}
$('create-form').addEventListener('change',persistCreateDraft);$('create-first-task').addEventListener('toggle',persistCreateDraft);$('create-appearance').addEventListener('toggle',persistCreateDraft);
$('create-form').addEventListener('click',event=>{const control=event.target.closest('[data-create-template]'),template=createTemplates[control?.dataset.createTemplate];if(!template)return;const form=$('create-form'),firstTask=form.elements.firstTask;form.elements.name.value=template.name;form.elements.instructions.value=template.instructions;if(!firstTask.value.trim()||firstTask.value===firstTask.dataset.starterSuggestion){firstTask.value=template.firstTask;firstTask.dataset.starterSuggestion=template.firstTask}else firstTask.dataset.starterSuggestion='';$('create-first-task').open=true;setCreateTemplateChoice(template.label,'Next: choose a project folder and review the starter task.');$('pod-template-selection').querySelector('button').focus({preventScroll:true});form.elements.name.dispatchEvent(new Event('input',{bubbles:true}))});
const appearanceSection=node('section');appearanceSection.dataset.view='profile';appearanceSection.append(node('h2','Appearance'),node('p','A familiar face in every conversation.','muted'),button('Customize Pod',()=>{if(!current)return;const form=$('appearance-form');form.reset();form.querySelector('.error').textContent='';for(const [key,value] of Object.entries(podAppearance(current.bot)))form.elements.namedItem(key).value=value;previewAppearance('appearance-preview',form,current.bot.name);window.Pod3D.reset($('appearance-preview').querySelector('.editor-avatar'));$('appearance-dialog').showModal()}));$('review-panel').querySelector('section').before(appearanceSection);
$('appearance-form').addEventListener('input',()=>previewAppearance('appearance-preview',$('appearance-form'),current?.bot.name));
$('appearance-form').addEventListener('submit',event=>submitForm(event,()=>api('/api/bots/'+selected+'/appearance',{appearance:formAppearance($('appearance-form'))})));
for(const control of document.querySelectorAll('[data-close]'))control.addEventListener('click',()=>control.closest('dialog').close());
$('delete-confirm-dialog').addEventListener('close',()=>{deleteConfirmName='';deleteConfirmAction=null});
$('delete-confirm-form').addEventListener('submit',event=>submitForm(event,async fields=>{if(fields.get('confirmation')!==deleteConfirmName)throw new Error('The name did not match.');if(!deleteConfirmAction)throw new Error('No deletion is awaiting confirmation.');await deleteConfirmAction()}));
async function submitForm(event,action){event.preventDefault();const form=event.currentTarget,control=submitter(event);control.disabled=true;try{await action(new FormData(form));form.closest('dialog')?.close();if(form.id!=='group-message-form')form.reset();form.querySelector('.error').textContent='';await refresh()}catch(error){form.querySelector('.error').textContent=error.message}finally{control.disabled=false}}
$('assign-task-pod').addEventListener('change',updateAssignTaskContext);
for(const [number,title,detail,prompt] of TASK_STARTERS){const choice=node('button',undefined,'assign-task-starter');choice.type='button';choice.append(node('strong',title),node('span',detail));choice.setAttribute('aria-label','Use '+title+' prompt. '+detail+' Review and edit it before queueing.');choice.addEventListener('click',()=>{const message=$('assign-task-message');message.value=prompt;message.focus();message.setSelectionRange(prompt.length,prompt.length)});$('assign-task-starters').append(choice)}
$('assign-task-form').addEventListener('submit',event=>submitForm(event,async fields=>{const botId=String(fields.get('botId')||''),message=String(fields.get('message')||'').trim(),bot=botsState.find(item=>item.id===botId&&item.enabled);if(!bot)throw new Error('Choose an enabled Pod to continue');if(!message)throw new Error('Describe the task before queuing it');const conversationId=await queueConversationTask(botId,message,true);if(selected!==botId||selectedGroup||overviewMode||mobilePodsPage)selectBot(botId);setConversationContext(conversationId,false);restoreDraft(botId,conversationId);setReviewOpen(false);notify('Task queued in a new conversation with '+bot.name+'.')}));
const reviewerCreateLabel=node('label','Completion reviewer model (optional)');const reviewerCreateInput=document.createElement('input');reviewerCreateInput.name='reviewerModel';reviewerCreateInput.maxLength=128;reviewerCreateInput.pattern='[A-Za-z0-9][A-Za-z0-9._:/\\-]{0,127}';reviewerCreateInput.placeholder='Use the pod model';reviewerCreateLabel.append(reviewerCreateInput,node('span','The completion check always runs. Leave blank to use this pod’s main model.','muted'));$('create-form').elements.agentConfig.closest('label').after(reviewerCreateLabel);
$('create-form').addEventListener('submit',event=>submitForm(event,async fields=>{
  const input=Object.fromEntries(fields),firstTask=String(fields.get('firstTask')||'').trim();delete input.firstTask;input.appearance=formAppearance($('create-form'),'appearance:');for(const key of Object.keys(appearanceOptions))delete input['appearance:'+key];if(!input.agentConfig)delete input.agentConfig;if(!input.reviewerModel)delete input.reviewerModel;
  const bot=await api('/api/bots',input);discardCreateDraft();selectBot(bot.id);
  if(firstTask){const occurrenceId=crypto.randomUUID();try{await queueConversationTask(bot.id,firstTask,true,occurrenceId);notify('Pod created and first task queued.')}catch(error){setConversationContext(null,true);saveDraft(bot.id,null,firstTask,occurrenceId);restoreDraft(bot.id,null);notify('Pod created. The first task is saved in its composer; send it again to retry: '+error.message)}}
}));
$('composer').addEventListener('submit',submitComposer);
const mobileComposer=matchMedia('(max-width: 760px)');function syncComposerHint(){$('composer-hint').textContent=mobileComposer.matches?'Return for a new line · Tap ↑ to send · Type / for commands':'Enter to send · Shift + Enter for a new line · Type / for commands'}syncComposerHint();mobileComposer.addEventListener('change',syncComposerHint);
$('message').addEventListener('input',()=>{messageKey=null;if(selected){saveDraft(selected,selectedConversation,$('message').value,null);showConversations()}renderCommandMenu();const prompts=$('starter-prompts');if(prompts.dataset.available==='true')prompts.hidden=Boolean($('message').value.trim())});
$('message').addEventListener('keydown',event=>{if(event.key==='ArrowDown'&&!$('command-menu').hidden){event.preventDefault();moveCommandSelection(1);return}if(event.key==='ArrowUp'&&!$('command-menu').hidden){event.preventDefault();moveCommandSelection(-1);return}if(event.key==='Tab'&&!$('command-menu').hidden){const option=$('command-menu').querySelectorAll('[role=option]')[commandSelection<0?0:commandSelection];if(option){event.preventDefault();acceptCommand(option.querySelector('code').textContent)}return}if(event.key==='Escape'&&!$('command-menu').hidden){$('command-menu').hidden=true;$('message').setAttribute('aria-expanded','false');$('message').removeAttribute('aria-activedescendant');return}if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){if(!$('command-menu').hidden&&commandSelection>=0){event.preventDefault();acceptCommand($('command-menu').querySelectorAll('[role=option]')[commandSelection].querySelector('code').textContent);return}if(mobileComposer.matches&&!$('message').value.trimStart().startsWith('/'))return;event.preventDefault();const control=$('composer').querySelector('button[type=submit]');if(!control.disabled&&$('message').value.trim())$('composer').requestSubmit(control)}});
$('toggle-bot').addEventListener('click',event=>perform(event.currentTarget,()=>api('/api/bots/'+selected+'/enabled',{enabled:!current.bot.enabled})));
$('export-bot').addEventListener('click',()=>{if(!selected)return;const link=document.createElement('a');link.href='/api/bots/'+encodeURIComponent(selected)+'/export';link.download='deepseek-bot-'+selected+'.json';link.click()});
$('delete-bot').addEventListener('click',()=>{if(!current)return;const bot=current.bot;openDeleteConfirmation('Delete Pod','This permanently deletes '+bot.name+' and its saved history, agent state and Codimium profile. Project files are kept.',bot.name,async()=>{await api('/api/bots/'+encodeURIComponent(bot.id)+'/delete',{confirmation:bot.name});if(selected===bot.id){clearBotDrafts(bot.id);selected=null;current=null;signatures.clear()}},'Delete Pod')});
function updateRoutinePreview(){const fields=$('routine-form').elements,kind=fields.kind.value;let preview;if(kind==='daily'){const timeZone=fields.timeZone.value;if(!timeZone)preview='Choose a time zone for this daily schedule.';else if(!fields.time.value)preview='Choose a time for this daily schedule.';else{try{new Intl.DateTimeFormat(undefined,{timeZone}).format();preview='Every day at '+fields.time.value+' · '+timeZone}catch{preview='Enter a valid time zone, such as America/Fortaleza.'}}}else if(kind==='interval'){const minutes=Number(fields.minutes.value);if(!Number.isInteger(minutes)||minutes<1||minutes>525600)preview='Choose an interval from 1 minute to 365 days.';else{const [count,unit]=minutes%1440===0?[minutes/1440,'day']:minutes%60===0?[minutes/60,'hour']:[minutes,'minute'];preview='Every '+count+' '+unit+(count===1?'':'s')}}else if(kind==='once'){const at=fields.at.value?new Date(fields.at.value):null;preview=at&&!Number.isNaN(at.getTime())?'Once · '+at.toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'})+' (your local time)':'Choose a date and local time.'}else{preview=fields.topic.value.trim()?'When event topic “'+fields.topic.value.trim()+'” is received.':'Enter an event topic to define this trigger.'}if(kind!=='once'&&fields.endsAt.value){const end=new Date(fields.endsAt.value);if(!Number.isNaN(end.getTime()))preview+=' · Through '+end.toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'})+' (your device’s local time)'}$('routine-preview-copy').textContent=preview}
function scheduleFields(){const kind=$('routine-form').elements.kind.value;for(const section of document.querySelectorAll('[data-schedule]')){section.hidden=section.dataset.schedule==='recurring'?kind==='once':section.dataset.schedule!==kind;for(const input of section.querySelectorAll('input'))input.required=!section.hidden&&input.name!=='endsAt'}updateRoutinePreview()}
function procedureFields(){const skill=current?.procedures.find(p=>p.id===$('routine-form').elements.procedureId.value),container=$('procedure-inputs');container.replaceChildren();if(!skill)return;for(const step of skill.steps){if(!step.input)continue;const label=node('label',step.input+(step.name?' — '+step.name:''));const input=node('input');input.name='procedure:'+step.input;input.required=true;input.maxLength=10000;label.append(input);container.append(label)}container.append(node('p','Use non-sensitive values for this routine. Passwords and login codes require human takeover.','muted'))}
function localDateTime(value){const date=new Date(value);return new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,-1)}
function openRoutine(routine=null){routineEdit=routine;routineKey=routine?null:crypto.randomUUID();const form=$('routine-form'),fields=form.elements;form.reset();form.querySelector('.error').textContent='';$('routine-title').textContent=routine?'Edit routine':'Add routine';$('routine-submit').textContent=routine?'Save changes':'Add routine';fields.name.value=routine?.name||'';fields.prompt.value=routine?.prompt||'';const select=fields.procedureId;select.replaceChildren(new Option('No browser skill',''));for(const skill of current?.procedures||[]){if(skill.status==='ready')select.append(new Option(skill.name,skill.id));else if(skill.id===routine?.procedureId)select.append(new Option(skill.name+' — needs review',skill.id))}select.value=routine?.procedureId&&current?.procedures.some(p=>p.id===routine.procedureId&&p.status==='ready')?routine.procedureId:'';const schedule=routine?.schedule;fields.kind.value=schedule?.kind||'daily';fields.timeZone.value=schedule?.kind==='daily'?schedule.timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone;if(schedule?.kind==='daily')fields.time.value=String(schedule.hour).padStart(2,'0')+':'+String(schedule.minute).padStart(2,'0');if(schedule?.kind==='interval')fields.minutes.value=String(schedule.everyMs/60000);if(schedule?.kind==='once')fields.at.value=localDateTime(schedule.at);if(schedule?.kind==='event')fields.topic.value=schedule.topic;if(schedule?.endsAt!==undefined)fields.endsAt.value=localDateTime(schedule.endsAt);procedureFields();if(schedule&&routine?.procedureId&&select.value===routine.procedureId)for(const [key,value] of Object.entries(routine.procedureInputs||{})){const input=form.elements.namedItem('procedure:'+key);if(input)input.value=value}scheduleFields();$('routine-dialog').showModal()}
$('new-note').addEventListener('click',()=>openNote(null));
$('note-form').addEventListener('submit',event=>submitForm(event,fields=>api('/api/bots/'+selected+'/notes'+(noteEdit?'/'+noteEdit.id:''),{content:fields.get('content'),source:fields.get('source'),expiresAt:fields.get('expiresAt')?new Date(fields.get('expiresAt')).getTime():null,...(noteEdit?{version:noteEdit.version}:{})})));
$('remove-note').addEventListener('click',event=>perform(event.currentTarget,async()=>{if(!noteEdit)return;await api('/api/bots/'+selected+'/notes/'+noteEdit.id+'/remove',{version:noteEdit.version});$('note-dialog').close();$('note-form').reset();noteEdit=null}));
$('guide-form').addEventListener('input',()=>{guideKey=crypto.randomUUID()});
$('guide-form').addEventListener('submit',event=>submitForm(event,fields=>api('/api/runs/'+guideRun+'/messages',{message:fields.get('message'),messageId:guideKey})));
$('learn-form').addEventListener('submit',event=>submitForm(event,async fields=>{await api('/api/bots/'+selected+'/procedures',{runId:learnRun,name:fields.get('name')})}));
$('routine-form').elements.procedureId.addEventListener('change',procedureFields);
$('new-routine').addEventListener('click',()=>openRoutine());$('new-delivery').addEventListener('click',()=>{$('delivery-form').reset();$('delivery-form').querySelector('.error').textContent='';$('delivery-dialog').showModal()});$('delivery-form').addEventListener('submit',event=>submitForm(event,async fields=>{const topics=fields.getAll('topics');if(!topics.length)throw new Error('Choose at least one task outcome');const target=await api('/api/bots/'+selected+'/deliveries',{url:fields.get('url'),topics});notify('Webhook added. Share its public verification key with the receiver.');return target}));
$('routine-form').elements.kind.addEventListener('change',scheduleFields);
$('routine-form').addEventListener('input',()=>{if(!routineEdit)routineKey=crypto.randomUUID();updateRoutinePreview()});
$('routine-form').addEventListener('submit',event=>submitForm(event,async fields=>{const kind=fields.get('kind');let schedule;if(kind==='daily'){const [hour,minute]=fields.get('time').split(':').map(Number);schedule={kind,hour,minute,timeZone:fields.get('timeZone')}}else if(kind==='interval')schedule={kind,everyMs:Number(fields.get('minutes'))*60000};else if(kind==='once')schedule={kind,at:new Date(fields.get('at')).getTime()};else schedule={kind,topic:fields.get('topic')};if(kind!=='once'&&fields.get('endsAt'))schedule.endsAt=new Date(fields.get('endsAt')).getTime();const procedureId=fields.get('procedureId'),payload={name:fields.get('name'),prompt:fields.get('prompt'),schedule,...(procedureId?{procedureId,procedureInputs:Object.fromEntries([...fields].filter(([key])=>key.startsWith('procedure:')).map(([key,value])=>[key.slice(10),value]))}:{})};if(routineEdit){await api('/api/bots/'+selected+'/routines/'+routineEdit.id,{...payload,procedureId:procedureId||null,version:routineEdit.version});routineEdit=null}else{await api('/api/bots/'+selected+'/routines',{...payload,occurrenceId:routineKey});routineKey=null}}));
$('reconcile-form').addEventListener('submit',event=>submitForm(event,fields=>api('/api/runs/'+reviewRun+'/reconcile',{evidence:fields.get('evidence')})));
const browserOpen=button('Open computer',async()=>{const epoch=authEpoch,id=selected;const state=await browserStatus();if(epoch!==authEpoch||id!==selected)return;setReviewOpen(false);$('computer-title').textContent=current.bot.name+'’s computer';$('browser-dialog').show();$('app-layout').classList.add('with-computer');if(state.runId&&state.contexts.some(context=>context.tabs.length))await browserImage()},'browser-control');browserOpen.hidden=true;$('agent-more-actions').append(browserOpen);
const retentionLabel=node('label','Automatically remove completed run history after');const retentionSelect=node('select');retentionSelect.id='retention-days';for(const [value,label] of [['never','Keep indefinitely'],['30','30 days'],['90','90 days'],['180','180 days'],['365','1 year'],['730','2 years']])retentionSelect.append(new Option(label,value));retentionLabel.append(retentionSelect);const retentionHelp=node('p','Runs with uncertain effects or used to create browser skills are kept for review.');retentionHelp.className='muted';$('export-bot').closest('section').insertBefore(retentionLabel,$('export-bot').closest('.actions'));$('export-bot').closest('section').insertBefore(retentionHelp,$('export-bot').closest('.actions'));const previousRefresh=refresh;refresh=async()=>{await previousRefresh();if(current){const days=current.bot.retentionDays===null?'never':String(current.bot.retentionDays);if(!Array.from(retentionSelect.options).some(option=>option.value===days))retentionSelect.add(new Option(days+' days',days));retentionSelect.value=days}};retentionSelect.addEventListener('change',event=>perform(retentionSelect,async()=>{const days=retentionSelect.value==='never'?null:Number(retentionSelect.value);await api('/api/bots/'+selected+'/retention',{days})}));
function syncBrowserControls(){const held=$('browser-dialog').dataset.held==='true';$('browser-take').disabled=!browserRun||held;$('browser-release').disabled=!browserRun||!held;for(const control of document.querySelectorAll('#browser-navigation input,#browser-navigation button,#browser-text input,#browser-text button,#browser-key,#browser-press,#browser-up,#browser-down,#browser-accept,#browser-dismiss,#browser-tab'))control.disabled=!browserRun||!held;$('browser-image').tabIndex=held?0:-1}
async function browserStatus(){const epoch=authEpoch,id=selected;const state=await api('/api/bots/'+id+'/browser');if(epoch!==authEpoch||id!==selected)throw new Error('The selected Pod changed. Open its computer again.');browserRun=state.runId;$('browser-state').textContent=!state.runId?'This Pod has no active task. Send a task to start its computer.':state.held?'You have control. Return it when you finish.':'Watching '+(current?.bot.name||'your Pod')+' work. Take over when you need to interact.';browserOpen.textContent=state.held?'Computer · you have control':'Open computer';$('browser-dialog').dataset.held=String(state.held);syncBrowserControls();if(!state.runId){browserView=null;$('browser-image').removeAttribute('src');$('browser-image').hidden=true}const tabSelect=$('browser-tab');tabSelect.replaceChildren();const main=state.contexts.find(context=>context.key.endsWith('|main'));if(main){main.tabs.forEach((tab,index)=>{const option=node('option',index+': '+(tab.title||tab.url));option.value=index;tabSelect.append(option)});tabSelect.value=main.active}return state}

let reviewerDirtyFor = null;const reviewerSection=node('section'),reviewerTitle=node('h2','Completion review'),reviewerInfo=node('p','The completion check is mandatory. Choose a model supported by this pod’s provider, or leave blank to inherit its active model. If review cannot run, the goal stays active.','muted'),reviewerForm=document.createElement('form'),reviewerModelLabel=node('label','Reviewer model'),reviewerModelInput=document.createElement('input'),reviewerHelp=node('p','Leave blank to use the pod model. Changes apply to new runs; active runs keep their starting setting.','muted'),reviewerError=node('p'),reviewerSave=document.createElement('button');reviewerSection.dataset.view='profile';reviewerSection.append(reviewerTitle,reviewerInfo);reviewerForm.id='reviewer-model-form';reviewerModelInput.id='reviewer-model';reviewerModelInput.name='model';reviewerModelInput.maxLength=128;reviewerModelInput.pattern='[A-Za-z0-9][A-Za-z0-9._:/\\-]{0,127}';reviewerModelInput.placeholder='Use pod model';reviewerModelLabel.append(reviewerModelInput);reviewerError.className='error';reviewerError.setAttribute('role','alert');reviewerSave.type='submit';reviewerSave.className='primary';reviewerSave.textContent='Save reviewer model';reviewerForm.append(reviewerModelLabel,reviewerHelp,reviewerSave,reviewerError);reviewerSection.append(reviewerForm);reviewerSection.hidden=true;$('history-section').before(reviewerSection);reviewerModelInput.addEventListener('input',()=>{reviewerDirtyFor=selected});reviewerForm.addEventListener('submit',event=>{event.preventDefault();const control=submitter(event),podId=selected;control.disabled=true;reviewerError.textContent='';void api('/api/bots/'+encodeURIComponent(podId)+'/reviewer-model',{model:reviewerModelInput.value.trim()||null}).then(()=>{if(reviewerDirtyFor===podId)reviewerDirtyFor=null;notify('Completion reviewer saved.');return refresh()}).catch(error=>{reviewerError.textContent=error.message}).finally(()=>{control.disabled=false})});const refreshWithReviewer=refresh;refresh=async()=>{await refreshWithReviewer();$('agent-more').hidden=overviewMode||!selected||!!selectedGroup;if($('agent-more').hidden)$('agent-more').open=false;reviewerSection.hidden=!selected;if(current&&reviewerDirtyFor!==selected&&document.activeElement!==reviewerModelInput){reviewerModelInput.value=current.bot.reviewerModel||'';reviewerDirtyFor=null}};
async function browserCommand(command,args){if(!browserRun)throw new Error('This agent has no active browser task');return api('/api/bots/'+selected+'/browser',{runId:browserRun,command,args})}
async function browserImage(){const epoch=authEpoch,id=selected,run=browserRun;const result=await browserCommand('image');if(epoch!==authEpoch||id!==selected||run!==browserRun||!$('browser-dialog').open)return;browserView=result;$('browser-image').src='data:image/jpeg;base64,'+result.image;$('browser-image').hidden=false}
async function browserAction(command,args){await browserCommand(command,args);await browserStatus();await browserImage()}
$('browser-take').addEventListener('click',event=>perform(event.currentTarget,()=>browserAction('take')));
$('browser-release').addEventListener('click',event=>perform(event.currentTarget,async()=>{await browserCommand('release');browserView=null;$('browser-image').hidden=true;$('browser-input').value='';await browserStatus()}));
$('browser-refresh').addEventListener('click',event=>perform(event.currentTarget,async()=>{const state=await browserStatus();if(state.runId)await browserImage()}));
$('computer-expand').addEventListener('click',()=>{const expanded=$('browser-dialog').classList.toggle('expanded');$('computer-expand').textContent=expanded?'Minimize':'Expand';$('computer-expand').setAttribute('aria-pressed',String(expanded))});
$('browser-navigation').addEventListener('submit',event=>{event.preventDefault();perform(submitter(event),()=>browserAction('navigate',{url:$('browser-url').value}))});
$('browser-text').addEventListener('submit',event=>{event.preventDefault();const text=$('browser-input').value;$('browser-input').value='';perform(submitter(event),()=>browserAction('type',{text}))});
$('browser-press').addEventListener('click',event=>perform(event.currentTarget,()=>browserAction('press',{key:$('browser-key').value})));
$('browser-up').addEventListener('click',event=>perform(event.currentTarget,()=>browserAction('scroll',{delta:-550})));
$('browser-down').addEventListener('click',event=>perform(event.currentTarget,()=>browserAction('scroll',{delta:550})));
$('browser-accept').addEventListener('click',event=>perform(event.currentTarget,async()=>{const state=await browserStatus();const text=state.dialog?.type==='prompt'?$('browser-input').value:undefined;$('browser-input').value='';await browserAction('dialog',{accept:true,text})}));
$('browser-dismiss').addEventListener('click',event=>perform(event.currentTarget,()=>browserAction('dialog',{accept:false})));
$('browser-tab').addEventListener('change',event=>perform(event.currentTarget,()=>browserAction('tab',{index:Number(event.currentTarget.value)})));
$('browser-image').addEventListener('click',event=>{if(!browserView||$('browser-dialog').dataset.held!=='true')return;const bounds=event.currentTarget.getBoundingClientRect();perform(event.currentTarget,()=>browserAction('click',{viewId:browserView.id,x:(event.clientX-bounds.left)*browserView.width/bounds.width,y:(event.clientY-bounds.top)*browserView.height/bounds.height}))});
$('browser-image').addEventListener('keydown',event=>{if($('browser-dialog').dataset.held!=='true')return;if(!['Enter','Tab','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Backspace','Escape'].includes(event.key))return;if(event.key==='Tab')return;event.preventDefault();perform(event.currentTarget,()=>browserAction('press',{key:event.key}))});
$('browser-dialog').addEventListener('close',()=>{$('app-layout').classList.remove('with-computer');$('browser-dialog').classList.remove('expanded');$('computer-expand').textContent='Expand';$('computer-expand').setAttribute('aria-pressed','false');browserOpen.focus();browserView=null;browserRun=null;$('browser-image').removeAttribute('src');$('browser-image').hidden=true;$('browser-input').value=''});
let computerRefreshing=false;setInterval(async()=>{if(computerRefreshing||!authenticated||document.hidden||!$('browser-dialog').open||$('browser-dialog').dataset.held==='true')return;computerRefreshing=true;try{const state=await browserStatus();if(state.runId&&state.contexts.some(context=>context.tabs.length))await browserImage()}catch(error){if($('browser-dialog').open)$('browser-state').textContent=error.message}finally{computerRefreshing=false}},4000);
setInterval(()=>{if(authenticated&&!document.hidden)void refresh()},2000);document.addEventListener('visibilitychange',()=>{if(authenticated&&!document.hidden)void refresh()});async function startPanel(){const url=new URL(location.href);const token=new URLSearchParams(url.hash.slice(1)).get('token');if(token){url.searchParams.delete('token');url.hash='';history.replaceState(null,'',url.pathname+url.search);try{await api('/api/login',{token})}catch(error){$('login-error').textContent=error.message;return}}await refresh()}void startPanel();
</script></body></html>`
