import { POD_APPEARANCE_OPTIONS, POD_TONE_COLORS } from './types.js'
import { POD_AVATAR_RUNTIME } from './pod-avatar-runtime.js'

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
#login form { margin-top: 28px; }
#login form button { width: 100%; }
.error { margin-top: 10px; color: var(--red); }
#app { height: 100dvh; display: grid; grid-template-rows: 58px minmax(0, 1fr); }
.top { min-width: 0; padding: 0 20px; border-bottom: 1px solid var(--line); background: var(--surface); }
.top .row { flex-wrap: nowrap; }
.top-actions { gap: 8px; }
.top-actions button { font-size: 12px; border-color: transparent; }
.connection { color: var(--muted); font-size: 11px; white-space: nowrap; }
.connection::before { display: inline-block; width: 6px; height: 6px; margin-right: 7px; border-radius: 50%; background: var(--green); content: ""; }
.connection[data-state="offline"]::before { background: var(--red); }
.panel-toggle { display: inline-flex; align-items: center; gap: 7px; }
.panel-toggle.needs-review { color: var(--amber); }
.review-count { padding: 0 5px; border-radius: 5px; background: var(--amber-wash); color: var(--amber); font-size: 11px; }
.layout { min-width: 0; min-height: 0; display: grid; grid-template-columns: 252px minmax(0, 1fr); }
.layout.with-review-panel { grid-template-columns: 252px minmax(0, 1fr) 340px; }
.layout.with-computer { padding-right: min(44vw, 640px); }
.rail { min-width: 0; min-height: 0; overflow: auto; display: flex; flex-direction: column; padding: 18px 12px; background: var(--surface); border-right: 1px solid var(--line); }
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
#group-list .bot { min-height: 36px; color: var(--muted); font-size: 12px; }
.bot-avatar { width: 48px; height: 48px; }
.workspace { min-width: 0; min-height: 0; display: flex; flex-direction: column; background: var(--canvas); }
.heading { padding: 20px 28px 16px; }
.heading-top { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.agent-title { min-width: 0; display: flex; align-items: center; gap: 12px; }
.agent-title > div { min-width: 0; }
#bot-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.heading .eyebrow { display: none; }
.agent-actions { display: flex; align-items: center; gap: 10px; }
.agent-actions button { min-height: 36px; padding: 6px 10px; font-size: 12px; border: 1px solid transparent; color: var(--muted); }
.agent-state { color: var(--muted); font-size: 11px; text-transform: capitalize; white-space: nowrap; }
.agent-state[data-state="running"] { color: var(--green); }
.agent-state[data-state="waiting"], .agent-state[data-state="blocked"] { color: var(--amber); }
.heading > p { max-width: 80ch; margin: 4px 0 0 72px; color: var(--muted); font-size: 13px; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.browser-control { margin: 0; font-size: 11px; color: var(--muted); border-color: transparent; padding: 4px 0; min-height: 28px; }
.browser-control::before { display: inline-block; width: 13px; height: 10px; margin-right: 8px; border: 1.5px solid currentColor; border-radius: 2px; content: ""; vertical-align: -1px; }
.feed-heading { padding: 0 30px; border-bottom: 1px solid var(--line); }
.workspace-tabs { display: flex; gap: 20px; }
.workspace-tabs button { min-height: 44px; padding: 6px 0; border: 0; border-radius: 0; color: var(--muted); font-size: 13px; }
.workspace-tabs button[aria-pressed="true"] { color: var(--ink); box-shadow: inset 0 -2px var(--ink); }
#feed { flex: 1; min-height: 0; overflow: auto; padding: 16px 36px 30px; }
.turn { width: min(800px, 100%); margin: 12px auto 28px; overflow-wrap: anywhere; }
.turn > .row.spread { justify-content: flex-end; gap: 10px; }
.badge { display: inline-flex; align-items: center; gap: 5px; color: var(--muted); font-size: 10px; text-transform: capitalize; }
.badge.running, .badge.completed { color: var(--green); }
.badge.waiting, .badge.blocked { color: var(--amber); }
.badge.failed { color: var(--red); }
.prompt { width: fit-content; max-width: 85%; margin: 8px 0 20px auto; padding: 12px 16px; border-radius: 12px 12px 3px 12px; background: var(--raised); font-size: 15px; white-space: pre-wrap; }
.agent-reply { display: flex; gap: 13px; align-items: flex-start; margin-top: 18px; }
.reply-content { min-width: 0; padding-top: 3px; }
.reply-name { display: block; margin-bottom: 7px; font-size: 12px; font-weight: 600; }
.answer { color: var(--ink); font-size: 15px; line-height: 1.75; white-space: pre-wrap; overflow-wrap: anywhere; }
.run-state-line { display: flex; align-items: center; gap: 10px; margin: 0 0 14px 44px; color: var(--muted); font-size: 12px; }
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
.suggestions { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; margin-top: 24px; }
.suggestions button { color: var(--muted); font-size: 12px; border-radius: 12px; }
#composer { padding: 14px 36px 20px; background: var(--canvas); }
.composer-field { width: min(800px, 100%); display: flex; align-items: flex-end; gap: 8px; margin: auto; padding: 10px; border: 1px solid var(--strong); border-radius: 14px; background: var(--soft); }
.composer-field:focus-within { border-color: var(--muted); }
#composer textarea { flex: 1; min-height: 44px; max-height: 160px; padding: 10px 8px; border: 0; background: transparent; resize: vertical; outline: none; }
#composer .composer-field button { width: 36px; min-width: 36px; height: 36px; min-height: 36px; padding: 0; margin-bottom: 4px; border-radius: 50%; font-size: 20px; }
.composer-hint { width: min(800px, 100%); margin: 8px auto 0; color: var(--subtle); font-size: 11px; text-align: left; }
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
.editor-heading { grid-column: 1 / -1; margin-bottom: 4px; }
.editor-heading .eyebrow { display: none; }
.editor-heading h2 { margin: 0 0 8px; font-size: 24px; font-weight: 600; letter-spacing: -.03em; }
.editor-heading .muted { font-size: 13px; }
#appearance-form, .create-character { display: grid; grid-template-columns: minmax(0, 280px) minmax(0, 1fr); gap: 20px 28px; }
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
.create-job { display: grid; grid-template-columns: minmax(0, 1fr); margin-top: 16px; }
#create-avatar-preview { position: static; padding: 16px 0; margin-bottom: 20px; border-radius: 8px; background: var(--soft); }
#create-avatar-preview .editor-avatar { width: 220px; height: 220px; }
#create-avatar-preview .preview-caption > p { display: none; }
#create-avatar-preview .preview-caption .muted { font-size: 11px; }
#create-form textarea { min-height: 100px; }
.create-job .responsibility-field { grid-column: 1 / -1; }
#create-form > details { margin: 4px 0 16px; }
#appearance-form > .actions, #create-form > .actions { justify-content: flex-end; padding-top: 16px; border-top: 1px solid var(--line); }
@media (max-width: 760px) {
  #appearance-dialog, #create-dialog { padding: 20px; }
  #appearance-form, .create-character { grid-template-columns: minmax(0, 1fr); gap: 14px; }
  #appearance-preview, #create-avatar-preview { position: static; padding: 16px 0; margin-bottom: 20px; border-radius: 8px; background: var(--soft); }
  .pod-avatar.editor-avatar { width: 200px; height: 200px; }
  .create-job { grid-template-columns: minmax(0, 1fr); }
  .choice-grid { grid-template-columns: repeat(5, minmax(0, 1fr)); }
  .options-tone .choice-grid { grid-template-columns: repeat(6, minmax(0, 1fr)); }
  .options-accessory .choice-grid { grid-template-columns: repeat(5, minmax(0, 1fr)); }
  .choice-avatar { width: 40px; height: 40px; }
  .choice-name { font-size: 10px; }
}

@keyframes pod-look { 50% { transform: translate(3px, -2px); } }
@keyframes breathe { 50% { opacity: .4; } }
@media (max-width: 1180px) {
  .layout { grid-template-columns: 216px minmax(0, 1fr); }
  .layout.with-review-panel { grid-template-columns: 216px minmax(0, 1fr) 300px; }
  .heading, #feed, #composer { padding-inline: 22px; }
  .feed-heading { padding-inline: 22px; }
}
@media (max-width: 860px) {
  #app { height: auto; min-height: 100dvh; grid-template-rows: 58px 1fr; }
  .layout { display: flex; flex-direction: column; }
  .layout.with-computer { padding-right: 0; }
  .rail { padding: 12px; border-right: 0; border-bottom: 1px solid var(--line); }
  .rail-search { margin-bottom: 12px; }
  #bots, #group-list { display: flex; gap: 4px; overflow-x: auto; }
  #bots .bot { width: 190px; min-width: 190px; }
  #group-list .bot { width: auto; flex-shrink: 0; }
  .groups-heading { margin-top: 14px; }
  .new { width: auto; }
  .workspace { min-height: 60dvh; }
  #feed { flex: none; overflow: visible; }
  .review, #browser-dialog, #browser-dialog.expanded { position: fixed; z-index: 3; inset: 58px 0 0 auto; width: min(440px, 100vw); height: calc(100dvh - 58px); overflow: auto; background: var(--surface); box-shadow: -20px 0 40px #0003; }
  .heading { padding-top: 18px; }
  #notice { z-index: 6; }
}
@media (max-width: 560px) {
  .top { padding-inline: 12px; }
  .top .brand { font-size: 13px; }
  .top-actions { gap: 3px; }
  .top-actions button { padding-inline: 6px; font-size: 11px; }
  .connection { width: 6px; overflow: hidden; font-size: 0; }
  .connection::before { margin: 0; }
  .brand-mark { width: 23px; height: 23px; }
  .heading, #feed, #composer { padding-inline: 16px; }
  .heading-top { gap: 8px; }
  .agent-title { gap: 10px; }
  .agent-avatar { width: 40px; height: 40px; }
  h1 { font-size: 18px; }
  .agent-actions { flex-direction: column; align-items: flex-end; gap: 4px; }
  .agent-actions button { padding: 0; min-height: 26px; }
  .heading > p { margin-left: 50px; }
  .feed-heading { padding-inline: 16px; }
  .workspace-tabs { justify-content: space-between; gap: 12px; }
  .workspace-tabs button { font-size: 11px; }
  .prompt { max-width: 94%; }
  .empty-state { grid-template-columns: minmax(0, 1fr); gap: 12px; margin-top: 24px; }
  .empty-state .hero-avatar { grid-column: 1; grid-row: auto; justify-self: start; width: 140px; height: 140px; }
  .empty-state h2 { font-size: 22px; }
  #composer { padding-bottom: max(18px, env(safe-area-inset-bottom)); }
  .composer-field { padding: 6px; }
  #browser-navigation, #browser-text { grid-template-columns: 1fr; }
  .appearance-grid { gap: 0 10px; }
}

.result-card { margin-bottom: 12px; padding: 16px 0; border-bottom: 1px solid var(--line); }
.result-card h3 { margin-top: 6px; overflow-wrap: anywhere; }
.result-card button, .result-link { min-height: 28px; margin-top: 10px; padding: 4px 8px; font-size: 11px; }
.result-card a { display: block; margin-top: 8px; font-size: 12px; }
.routine-next { color: var(--green); font-size: 11px; }
.bot-details { position: relative; }
.unread-dot { display: inline-block; margin-left: 6px; font-size: 10px; color: var(--amber); }
.group-faces { display: flex; flex: 0 0 auto; }
.group-faces .pod-avatar + .pod-avatar { margin-left: -14px; }
.member-choice { display: inline-flex; align-items: center; gap: 4px; margin: 0; }
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
@media (max-width: 560px) { #group-dialog .group-messages, #group-message-form { padding-inline: 16px; } .workspace-tabs { gap: 8px; } }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; scroll-behavior: auto !important; }
}
</style></head><body>

<div id="notice" role="alert" hidden></div>
<section id="login" aria-labelledby="login-title"><div class="login-card"><div class="brand"><img class="brand-mark" src="/logo.png" alt="" width="32" height="28"><span>DeepSeek <b>Pods</b></span></div><p class="eyebrow">Supervisor access</p><h1 id="login-title">Sign in to your workspace</h1><p class="login-copy">Sign in to follow agent activity, send work and review requests in this workspace.</p><form id="login-form"><label>Access token<input id="token" type="password" autocomplete="current-password" required></label><button class="primary" type="submit">Sign in</button><p id="login-error" class="error" role="alert"></p></form></div></section>
<div id="app" hidden><header class="top row spread"><div class="brand"><img class="brand-mark" src="/logo.png" alt="" width="32" height="28"><span>DeepSeek <b>Pods</b></span></div><div class="row top-actions"><span id="connection" class="connection">Connected</span><button id="toggle-review" class="panel-toggle" type="button" aria-controls="review-panel" aria-expanded="false"><span id="review-label">Activity</span><span id="review-count" class="review-count" hidden>0</span></button><button id="theme-toggle" type="button" aria-label="Switch to light theme">Light</button><button id="logout">Sign out</button></div></header>
<div class="layout" id="app-layout"><nav class="rail" aria-label="Your Pods"><label class="rail-search"><input id="pod-search" type="search" aria-label="Search Pods" placeholder="Search your Pods"></label><div class="rail-heading"><h2>Your Pods</h2><span id="bot-count" class="rail-count">0</span></div><div id="bots"></div><button id="new-bot" class="new">New Pod</button><div class="rail-heading groups-heading"><h2>Group chats</h2></div><div id="group-list"></div><button id="new-group" class="new">Create group</button></nav>
<main class="workspace"><header class="heading"><div class="heading-top"><div class="agent-title"><span id="bot-avatar" class="agent-avatar" aria-hidden="true">PO</span><div><p class="eyebrow">DeepSeek Pod</p><h1 id="bot-name">Your agents</h1></div></div><div class="agent-actions"><span id="agent-state" class="agent-state" data-state="ready">Ready</span><button id="toggle-bot" hidden>Pause new work</button></div></div><p id="responsibility" class="muted">Create an agent with a project and a responsibility to get started.</p></header><div class="feed-heading"><nav class="workspace-tabs" aria-label="Pod workspace"><button type="button" data-workspace-view="conversation" aria-pressed="true">Conversation</button><button type="button" data-workspace-view="activity" aria-pressed="false">Activity</button><button type="button" data-workspace-view="scheduled" aria-pressed="false">Scheduled</button><button type="button" data-workspace-view="library" aria-pressed="false">Library</button><button type="button" data-workspace-view="profile" aria-pressed="false">Profile</button></nav></div><div id="feed" aria-label="Pod conversation"></div>
<form id="composer" hidden><div class="composer-field"><textarea id="message" aria-label="Task for this agent" required maxlength="100000" placeholder="Message your Pod&#8230;"></textarea><button type="submit" class="primary" aria-label="Send task">&#8593;</button></div><p class="composer-hint">Enter to send &#183; Shift + Enter for a new line</p></form></main>
<aside id="review-panel" class="review" data-view="activity" aria-label="Pod activity and profile" hidden><div class="review-panel-header"><span id="review-title" class="eyebrow">Activity</span><button id="close-review" type="button">Close</button></div><section data-view="activity"><div class="activity-summary" role="status" aria-label="Task status summary"><span class="activity-stat"><i class="status-dot active"></i><b id="active-count">0</b> active</span><span class="activity-stat"><i class="status-dot attention"></i><b id="attention-count">0</b> attention</span><span class="activity-stat"><i class="status-dot complete"></i><b id="completed-count">0</b> complete</span><span id="run-count" class="run-count">0 tasks</span></div><h2>Needs your attention</h2><div id="decisions"><p class="muted">Requests for approval appear here.</p></div></section><section data-view="activity" id="history-section" hidden><h2>Search task history</h2><form id="history-search-form"><label>Search this agent's past tasks<input name="query" minlength="2" maxlength="128" required placeholder="A phrase or identifier"></label><button type="submit">Search</button><p class="error" role="alert"></p></form><div id="history-results"></div></section><section data-view="library"><h2>Saved results</h2><div id="library-results"></div></section><section data-view="scheduled"><div class="row spread"><h2>Routines</h2><button id="new-routine" hidden>Add routine</button></div><div id="routines"></div></section><section data-view="scheduled"><h2>Learned browser skills</h2><div id="procedures"></div></section><section data-view="profile"><div class="row spread"><h2>Memory</h2><button id="new-note" hidden>Add note</button></div><div id="notes"></div></section><section data-view="profile"><h2>Data and privacy</h2><p class="muted">Export includes this agent's saved work and activity. Browser cookies, provider credentials and private browser profile files are excluded.</p><div class="actions"><button id="export-bot" hidden>Export data</button><button id="delete-bot" class="danger" hidden>Delete agent</button></div></section><section data-view="profile"><div class="row spread"><h2>External delivery</h2><button id="new-delivery" hidden>Add webhook</button></div><p class="muted">Signed HTTPS notifications are sent when a selected task finishes. The receiver must verify the Ed25519 signature.</p><div id="deliveries"></div></section><details data-view="activity" id="activity" open><summary>Tool activity</summary><div id="activity-list"></div></details></aside>
</div></div>
<dialog id="browser-dialog" data-held="false" aria-labelledby="computer-title"><div class="row spread"><h2 id="computer-title">Pod&#8217;s computer</h2><div class="row"><button id="computer-expand" type="button" aria-pressed="false">Expand</button><button type="button" data-close>Close view</button></div></div><p class="eyebrow">Codimium browser</p><p id="browser-state" class="muted"></p><div class="actions"><button id="browser-take">Take over</button><button id="browser-release">Return to agent</button><button id="browser-refresh">Refresh view</button></div><form id="browser-navigation"><label>Go to a page<input id="browser-url" type="url" required placeholder="https://example.com"></label><button type="submit">Navigate</button></form><img id="browser-image" alt="Current Codimium browser page" tabindex="0" hidden><p class="muted">Click the page to focus a field. Browser actions pause while you have control.</p><form id="browser-text"><label>Text to enter in the focused field<input id="browser-input" type="password" autocomplete="off" maxlength="16000" required></label><button type="submit">Send text to browser</button></form><div class="actions"><label>Key<select id="browser-key"><option>Enter</option><option>Tab</option><option>Backspace</option><option>Escape</option><option>ArrowDown</option><option>ArrowUp</option></select></label><button id="browser-press">Press key</button><button id="browser-up">Scroll up</button><button id="browser-down">Scroll down</button><button id="browser-accept">Accept dialog</button><button id="browser-dismiss">Dismiss dialog</button></div><label>Tab<select id="browser-tab"></select></label><p class="muted">Typed text is cleared after sending. It is never added to the agent's conversation or tool logs.</p></dialog>
<dialog id="create-dialog" aria-labelledby="create-title"><form id="create-form"><header class="editor-heading"><p class="eyebrow">NEW TEAMMATE</p><h2 id="create-title">Create a Pod</h2><p class="muted">Choose its appearance and the project it will work on.</p></header><div class="create-character"><div class="create-info"><div id="create-avatar-preview" class="appearance-preview"></div><div class="create-job"><label>Name<input name="name" required maxlength="64" pattern="[a-zA-Z0-9][a-zA-Z0-9_-]*" placeholder="engineer"></label><label>Project folder<input name="projectRoot" required placeholder="/home/you/project"></label><label class="responsibility-field">What should this Pod do?<textarea name="instructions" required placeholder="Maintain this project and report observed results."></textarea></label></div></div><div id="create-appearance-fields" class="appearance-grid"></div></div><details><summary>Advanced settings</summary><label>Agent configuration (optional)<input name="agentConfig" placeholder="Existing configuration name"></label></details><p class="error" role="alert"></p><div class="actions"><button type="submit" class="primary">Create Pod</button><button type="button" data-close>Cancel</button></div></form></dialog>
<dialog id="appearance-dialog" aria-labelledby="appearance-title"><form id="appearance-form"><header class="editor-heading"><p class="eyebrow">APPEARANCE</p><h2 id="appearance-title">Edit appearance</h2><p class="muted">Changes appear in your conversations and roster.</p></header><div id="appearance-preview" class="appearance-preview"></div><div id="appearance-fields" class="appearance-grid"></div><p class="error" role="alert"></p><div class="actions"><button type="submit" class="primary">Save appearance</button><button type="button" data-close>Cancel</button></div></form></dialog>
<dialog id="note-dialog"><form id="note-form"><h2>Edit saved memory</h2><label>Saved fact<textarea name="content" required maxlength="10000"></textarea></label><label>Source<input name="source" required maxlength="4096" placeholder="Where this fact was confirmed"></label><label>Expires at (optional)<input name="expiresAt" type="datetime-local" step="0.001"></label><p class="muted">Notes are references, never permission grants. Updates affect new proposals; actions already started may finish. Removing a note removes current saved memory; conversation and activity history stay available.</p><p class="error" role="alert"></p><div class="actions"><button type="submit" class="primary">Save note</button><button type="button" id="remove-note" class="danger" hidden>Remove note</button><button type="button" data-close>Cancel</button></div></form></dialog>
<dialog id="guide-dialog"><form id="guide-form"><h2>Guide this active task</h2><p class="muted">The agent will reconsider its next steps. Actions already started may finish; stop the task if you need to interrupt it.</p><label>Your correction<textarea name="message" required maxlength="100000" placeholder="What should change in the current task?"></textarea></label><p class="error" role="alert"></p><div class="actions"><button type="submit" class="primary">Send guidance</button><button type="button" data-close>Cancel</button></div></form></dialog>
<dialog id="learn-dialog"><form id="learn-form"><h2>Learn this browser procedure</h2><p class="muted">Reuse the observed steps with new inputs. Each execution checks the current page. A changed page pauses the routine for review.</p><label>Skill name<input name="name" required maxlength="64" pattern="[a-z0-9]+(-[a-z0-9]+)*" placeholder="prepare-daily-report"></label><p class="error" role="alert"></p><div class="actions"><button type="submit" class="primary">Save skill</button><button type="button" data-close>Cancel</button></div></form></dialog>
<dialog id="routine-dialog"><form id="routine-form"><h2 id="routine-title">Add routine</h2><label>Name<input name="name" required maxlength="128"></label><label>Task<textarea name="prompt" required maxlength="10000"></textarea></label><label>Browser skill<select name="procedureId"><option value="">No browser skill</option></select></label><div id="procedure-inputs"></div><label>Schedule<select name="kind"><option value="daily">Every day</option><option value="interval">At an interval</option><option value="once">Once</option><option value="event">When an event arrives</option></select></label><div data-schedule="daily"><label>Time<input name="time" type="time" value="08:00"></label><label>Time zone<input name="timeZone" placeholder="America/Fortaleza"></label></div><div data-schedule="interval" hidden><label>Every (minutes)<input name="minutes" type="number" min="1" max="525600" value="60"></label></div><div data-schedule="once" hidden><label>Local date and time<input name="at" type="datetime-local"></label></div><div data-schedule="event" hidden><label>Event topic<input name="topic" placeholder="issue-created"></label></div><div data-schedule="recurring" hidden><label>Runs through (optional, your local time)<input name="endsAt" type="datetime-local" step="0.001"></label></div><p class="muted">Changes apply to future occurrences. Work already queued keeps its original instructions.</p><p class="error" role="alert"></p><div class="actions"><button id="routine-submit" type="submit" class="primary">Add routine</button><button type="button" data-close>Cancel</button></div></form></dialog>
<dialog id="delivery-dialog"><form id="delivery-form"><h2>Add signed webhook</h2><label>HTTPS receiver URL<input name="url" type="url" required maxlength="2048" placeholder="https://example.com/hooks/deepseek"></label><p class="muted">Use a public host on port 443. Query strings and URL credentials are not accepted. Private signing keys stay on the worker host.</p><label><input name="topics" type="checkbox" value="run.completed" checked> Completed tasks</label><label><input name="topics" type="checkbox" value="run.failed" checked> Failed tasks</label><label><input name="topics" type="checkbox" value="run.blocked" checked> Tasks blocked for review</label><p class="error" role="alert"></p><div class="actions"><button type="submit" class="primary">Add webhook</button><button type="button" data-close>Cancel</button></div></form></dialog>
<dialog id="group-create-dialog"><form id="group-create-form"><h2>Create collaboration group</h2><label>Group name<input name="name" maxlength="64" required></label><p class="muted">Select at least two enabled agents. Group messages and artifacts are shared with all selected agents.</p><div id="group-create-members" class="group-members"></div><label><input name="shareBrowser" type="checkbox"> Share this group's Codimium browser profile and cookies. Only one group task can use the browser at a time.</label><p class="error" role="alert"></p><div class="actions"><button type="submit" class="primary">Create group</button><button type="button" data-close>Cancel</button></div></form></dialog>
<section id="group-dialog" hidden aria-label="Group conversation"><header class="heading"><div class="row spread"><h2 id="group-title">Collaboration group</h2><button id="group-library" type="button">Library</button></div><p id="group-description" class="muted"></p></header><div id="group-transcript" class="group-messages" aria-live="polite"></div><h3>Shared artifacts</h3><div id="group-artifacts"></div><form id="group-message-form"><div id="group-recipients" class="group-members"></div><label>Send a group task<textarea name="message" required maxlength="100000"></textarea></label><p class="muted">Choose which teammates should reply.</p><p class="error" role="alert"></p><div class="actions"><button type="submit" class="primary">Send to selected agents</button><button type="button" id="delete-group" class="danger">Delete group</button></div></form></section>
<dialog id="reconcile-dialog"><form id="reconcile-form"><h2>Review interrupted work</h2><p class="muted">Inspect the effects on the worker host before continuing. A task may have acted before it stopped.</p><label>What did you verify?<textarea name="evidence" required maxlength="10000" placeholder="Describe the effects you observed and why continuing is safe."></textarea></label><p class="error" role="alert"></p><div class="actions"><button type="submit" class="primary">Save review</button><button type="button" data-close>Cancel</button></div></form></dialog>
<script nonce="__NONCE__">
${POD_AVATAR_RUNTIME}

const $ = id => document.getElementById(id);
let guideRun = null, guideKey = null, noteEdit = null, routineEdit = null;
let selected = null, current = null, selectedGroup = null, groupMessageKey = null, botsState = [], authenticated = false, refreshing = false, messageKey = null, routineKey = null, reviewRun = null, learnRun = null, eventCursor = 0, eventItems = [], browserRun = null, browserView = null, authEpoch = 0, reviewOpen = false, pendingDecisions = 0, observedDecisionBot = null, observedDecisionIds = new Set();
const signatures = new Map();
const drafts = new Map();
const seenActivity = new Map();
try{const saved=JSON.parse(localStorage.getItem('deepseek.pods.seen.v1')||'[]');if(Array.isArray(saved))for(const pair of saved)if(Array.isArray(pair)&&typeof pair[0]==='string'&&typeof pair[1]==='string')seenActivity.set(pair[0],pair[1])}catch{}
function activityStamp(pod){const run=pod.latestRun;return run&&['completed','failed','waiting','blocked'].includes(run.status)?run.id+':'+run.status+':'+run.updatedAt:null}
function markSeen(pod){const stamp=activityStamp(pod);if(!stamp||document.hidden)return;seenActivity.set(pod.id,stamp);try{localStorage.setItem('deepseek.pods.seen.v1',JSON.stringify([...seenActivity].slice(-512)))}catch{}}
function downloadText(name,content){const url=URL.createObjectURL(new Blob([content],{type:'text/plain;charset=utf-8'}));const link=node('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
function resultCard(run){const card=node('article',undefined,'result-card');card.dataset.run=run.id;card.append(node('span','Saved result · '+date(run.updatedAt||run.createdAt),'muted'),node('h3',run.prompt.slice(0,100)));const details=node('details');details.append(node('summary','Read result'),node('pre',run.output));card.append(details,button('Download result',()=>downloadText('pod-result-'+run.id+'.txt',run.output)));const links=[...new Set(run.output.match(/https?:\/\/[^\s<>"']+/g)||[])].slice(0,8);for(const raw of links){try{const url=new URL(raw);if(url.username||url.password)continue;const link=node('a',url.hostname);link.href=url.href;link.target='_blank';link.rel='noopener noreferrer';card.append(link)}catch{}}return card}
function showLibrary(runs){update('library-results',{runs: runs.filter(run=>run.status==='completed'&&run.output)},container=>{container.replaceChildren();for(const run of runs)if(run.status==='completed'&&run.output)container.append(resultCard(run));if(!container.childNodes.length)container.append(node('p','Completed results will be waiting here.','muted'))})}
function syncGroupWorkspace(){const group=Boolean(selectedGroup);document.querySelector('.workspace').dataset.group=String(group);$('group-dialog').hidden=!group}
document.querySelector('.workspace').append($('group-dialog'));
$('group-library').addEventListener('click',()=>{$('group-artifacts').hidden=!$('group-artifacts').hidden;$('group-library').setAttribute('aria-expanded',String(!$('group-artifacts').hidden))});

const routineRunKeys = new Map();
function node(tag,text,className){const el=document.createElement(tag);if(text!==undefined)el.textContent=String(text);if(className)el.className=className;return el}
function submitter(event){return event.submitter||event.currentTarget.querySelector('button[type="submit"],button:not([type])')}
function button(text,action,className){const el=node('button',text,className);el.type='button';el.addEventListener('click',()=>perform(el,action));return el}
function notify(message){$('notice').textContent=message;$('notice').hidden=!message}
async function api(path,data){const response=await fetch(path,{method:data===undefined?'GET':'POST',headers:data===undefined?{}:{'content-type':'application/json'},body:data===undefined?undefined:JSON.stringify(data),credentials:'same-origin'});const value=await response.json();if(!response.ok){if(response.status===401)signOut();throw new Error(value.error||'Request failed')}return value}
async function perform(control,action){control.disabled=true;try{await action();notify('');await refresh()}catch(error){notify(error.message)}finally{control.disabled=false;if(control.closest('#browser-dialog'))syncBrowserControls()}}
function update(id,value,render){const signature=JSON.stringify(value);if(signatures.get(id)===signature)return;signatures.set(id,signature);render($(id))}
function date(value){return new Date(value).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}
function closeDialogs(){for(const dialog of document.querySelectorAll('dialog[open]'))dialog.close();browserRun=null;browserView=null;selectedGroup=null;syncGroupWorkspace();groupMessageKey=null;$('browser-image').removeAttribute('src');$('browser-image').hidden=true;$('browser-input').value='';reviewRun=null;learnRun=null;routineKey=null;routineEdit=null;guideRun=null;guideKey=null;noteEdit=null}
function signOut(){authEpoch++;authenticated=false;selected=null;current=null;botsState=[];closeDialogs();signatures.clear();drafts.clear();routineRunKeys.clear();messageKey=null;eventItems=[];eventCursor=0;for(const form of document.querySelectorAll('form'))form.reset();$('pod-search').value='';setReviewOpen(false);for(const id of ['bots','group-list','feed','decisions','routines','notes','procedures','activity-list','deliveries','group-transcript','group-artifacts','group-recipients','group-create-members','history-results','library-results','appearance-preview','create-avatar-preview'])$(id).replaceChildren();$('bot-name').textContent='';$('responsibility').textContent='';$('app').hidden=true;$('login').hidden=false}
function selectBot(id){browserOpen.textContent='Open computer';reviewOpen=false;pendingDecisions=0;observedDecisionBot=null;observedDecisionIds.clear();if(selected)drafts.set(selected,{message:$('message').value,key:messageKey});selected=id;current=null;setReviewOpen(false);$('review-count').hidden=true;$('toggle-review').classList.remove('needs-review');$('review-label').textContent='Activity';closeDialogs();const draft=drafts.get(id);$('message').value=draft?.message||'';messageKey=draft?.key||null;signatures.clear();eventCursor=0;eventItems=[];for(const id of ['feed','decisions','routines','notes','procedures','activity-list','deliveries','history-results'])$(id).replaceChildren();$('history-search-form').reset();$('history-search-form').querySelector('.error').textContent=''}
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
function setReviewOpen(open,view=reviewView){reviewOpen=Boolean(open&&selected);reviewView=view;$('review-panel').dataset.view=view;$('review-title').textContent={activity:'Activity',scheduled:'Scheduled',profile:'Profile',library:'Library'}[view];$('review-panel').hidden=!reviewOpen;$('app-layout').classList.toggle('with-review-panel',reviewOpen);$('toggle-review').hidden=!selected;$('toggle-review').setAttribute('aria-expanded',String(reviewOpen));for(const tab of document.querySelectorAll('[data-workspace-view]'))tab.setAttribute('aria-pressed',String(tab.dataset.workspaceView===(reviewOpen?view:'conversation')));if(reviewOpen&&$('browser-dialog').open)$('browser-dialog').close()}
function updateReviewAttention(decisions){const ids=new Set(decisions.map(decision=>decision.id));const hasNew=selected!==observedDecisionBot||[...ids].some(id=>!observedDecisionIds.has(id));if(ids.size&&hasNew){reviewOpen=true;reviewView='activity'}observedDecisionBot=selected;observedDecisionIds=ids}
function showBots(bots){botsState=bots;$('bot-count').textContent=String(bots.length);update('bots',{bots,selected,search:$('pod-search').value,seen:[...seenActivity],attention:current?.decisions?.length||0},container=>{container.replaceChildren();const query=$('pod-search').value.trim().toLowerCase();const matches=bots.filter(bot=>(bot.name+' '+bot.instructions).toLowerCase().includes(query));for(const bot of matches){const el=button('',async()=>{if(selected===bot.id&&!selectedGroup)return;selectBot(bot.id);await refresh()},'bot'+(selected===bot.id?' selected':''));el.setAttribute('aria-current',selected===bot.id?'true':'false');const state=podState(bot);el.dataset.state=state;el.title=bot.name+' · '+state;const character=avatar(bot,'bot-avatar',state);const details=node('span',undefined,'bot-details');details.append(node('strong',bot.name));const stamp=activityStamp(bot);if(stamp&&seenActivity.get(bot.id)!==stamp){const unread=node('span','New','unread-dot');unread.setAttribute('aria-label','Unread activity');details.append(unread)}const meta=node('span',undefined,'bot-meta');const statusLabel=node('span',state,'agent-status');statusLabel.dataset.state=state;meta.append(statusLabel);const previewText=bot.latestRun?.output||bot.latestRun?.prompt||'';const preview=node('span',previewText?previewText.replace(/\s+/g,' ').slice(0,88):(bot.enabled?bot.instructions:'Pod paused'),'bot-preview');if(previewText)preview.title=previewText;meta.append(preview);details.append(meta);el.append(character,details);container.append(el)}if(!matches.length)container.append(node('p',bots.length?'No matching Pods.':'Your first Pod starts here.','muted'))})}
function showNoAgents(){setReviewOpen(false);pendingDecisions=0;$('review-count').hidden=true;$('toggle-review').hidden=true;$('bot-name').textContent='Your Pods';setAvatar($('bot-avatar'),{name:'Pod'});$('agent-state').textContent='Ready';$('agent-state').dataset.state='ready';$('responsibility').textContent='Give an agent a project folder and a clear responsibility. You can add tasks, routines and review settings after setup.';$('run-count').textContent='';$('active-count').textContent='0';$('attention-count').textContent='0';$('completed-count').textContent='0';const empty=node('section',undefined,'empty-state');empty.append(avatar({name:'Pod'},'hero-avatar'),node('p','START HERE','eyebrow'),node('h2','Create your first Pod'),node('p','Choose a project and tell your Pod what to do. Its conversations, results and routines stay in this workspace.'));const actions=node('div',undefined,'actions');const create=node('button','Create your first Pod','primary');create.type='button';create.addEventListener('click',openCreate);actions.append(create);empty.append(actions);$('feed').replaceChildren(empty)}
function showRuns(runs,unreconciled,guidance,legacyTranscript){update('feed',{runs,unreconciled,guidance,legacyTranscript,pod:current?.bot},container=>{const followBottom=!container.childElementCount||container.scrollHeight-container.scrollTop-container.clientHeight<80;const scrollTop=container.scrollTop;const open=new Set([...container.querySelectorAll('details[open]')].map(el=>el.dataset.run));container.replaceChildren();const active=runs.filter(run=>['queued','running'].includes(run.status)).length;const attention=runs.filter(run=>['waiting','blocked','failed'].includes(run.status)||unreconciled.includes(run.id)).length;const completed=runs.filter(run=>run.status==='completed').length;$('active-count').textContent=String(active);$('attention-count').textContent=String(attention);$('completed-count').textContent=String(completed);$('run-count').textContent=runs.length===1?'1 task':runs.length+' tasks';if(!runs.length){const empty=node('section',undefined,'empty-state');empty.append(avatar(current?.bot,'hero-avatar'),node('h2','What can '+(current?.bot.name||'your Pod')+' help with?'),node('p',current?.bot.instructions||'Send a task to start working together.'));const suggestions=node('div',undefined,'suggestions');for(const prompt of ['Review the project','Summarize recent changes','Suggest next steps'])suggestions.append(button(prompt,()=>{$('message').value=prompt;messageKey=null;$('message').focus()}));empty.append(suggestions);container.append(empty)}const ordered=[...runs].reverse().sort((a,b)=>Date.parse(a.createdAt)-Date.parse(b.createdAt));for(const run of ordered){const el=node('article',undefined,'turn');const head=node('div',undefined,'row spread');head.append(node('span',(run.testMode?'Safe test · ':'')+run.status,'badge '+run.status),node('time',date(run.createdAt)));el.append(head,node('p',run.prompt,'prompt'));if(!run.output&&!run.error){const stateCopy={queued:'Queued — this agent will start when it is free.',running:'Working now — new activity will appear here.',waiting:'Waiting for your input to continue.',blocked:'Paused for review. Check the action details before retrying.',completed:'Task completed.',failed:'This task could not finish. Open its details or retry.',cancelled:'This task was stopped.'}[run.status];if(stateCopy){const progress=node('div',undefined,'run-state-line '+run.status);progress.append(node('span',undefined,'run-pulse'),node('span',stateCopy));el.append(progress)}}for(const message of guidance.filter(message=>message.runId===run.id)){const intervention=node('div',undefined,'guidance-message');intervention.append(node('p',message.content,'prompt'),node('p',message.sequence<=run.steeringCursor?'Guidance received by the agent':'Guidance saved — awaiting the agent','muted'));el.append(intervention)}if(run.output){const reply=node('div',undefined,'agent-reply');reply.append(avatar(current?.bot,'reply-avatar',run.status));const content=node('div',undefined,'reply-content');content.append(node('span',current?.bot.name||'Agent','reply-name'),node('div',run.output,'answer'));if(run.status==='completed')content.append(button('Saved in Library',()=>setReviewOpen(true,'library'),'result-link'));reply.append(content);el.append(reply)}if(run.error)el.append(node('p',run.error,'error'));const actions=node('div',undefined,'actions');if(['running','waiting'].includes(run.status)&&run.acceptingMessages)actions.append(button('Guide task',async()=>{guideRun=run.id;guideKey=crypto.randomUUID();$('guide-dialog').showModal()}));if(['queued','running','waiting','blocked'].includes(run.status))actions.append(button('Stop task',()=>api('/api/runs/'+run.id+'/cancel',{}),'danger'));if(unreconciled.includes(run.id)){actions.append(button('Review effects',async()=>{reviewRun=run.id;$('reconcile-dialog').showModal()}))}else if(['failed','blocked'].includes(run.status)&&run.owner===null){actions.append(button('Retry task',()=>api('/api/runs/'+run.id+'/retry',{reconciled:run.status==='blocked'})))}if(run.status==='completed'&&run.owner===null&&run.browserStepCount>1)actions.append(button('Learn browser skill',async()=>{learnRun=run.id;$('learn-dialog').showModal()}));if(actions.childNodes.length)el.append(actions);const info=node('details');info.dataset.run=run.id;info.open=open.has(run.id);info.append(node('summary','Task conversation and details'),node('p','Occurrence: '+run.occurrenceId,'muted'));let loaded=false;info.addEventListener('toggle',async()=>{if(!info.open||loaded)return;loaded=true;try{const transcript=await api('/api/runs/'+run.id+'/transcript');if(info.isConnected)info.append(node('pre',JSON.stringify(transcript.messages,null,2)))}catch(error){loaded=false;if(info.isConnected)info.append(node('p',error.message,'error'))}});el.append(info);container.append(el)}if(legacyTranscript?.length){const legacy=node('details');legacy.append(node('summary','Unassigned legacy conversation'),node('p','Preserved from before task isolation. It is not used as context for any new task.','muted'),node('pre',JSON.stringify(legacyTranscript,null,2)));container.append(legacy)}container.scrollTop=runs.length?(followBottom?container.scrollHeight:scrollTop):0})}
function showHistory(results){const container=$('history-results');container.replaceChildren();if(!results.length){container.append(node('p','No matching finished tasks in this agent history.','muted'));return}for(const result of results){const item=node('div',undefined,'routine');item.append(node('p',result.status+' · '+date(result.createdAt)+' · '+result.source,'muted'),node('p',result.promptExcerpt,'prompt'));if(result.resultExcerpt)item.append(node('p',result.resultExcerpt));const details=node('details');details.append(node('summary','Open full task transcript'));let loaded=false;details.addEventListener('toggle',async()=>{if(!details.open||loaded)return;loaded=true;try{const transcript=await api('/api/runs/'+encodeURIComponent(result.runId)+'/transcript');if(details.isConnected)details.append(node('pre',JSON.stringify(transcript.messages,null,2)))}catch(error){loaded=false;if(details.isConnected)details.append(node('p',error.message,'error'))}});item.append(details);container.append(item)}}
function showDecisions(decisions){updateReviewAttention(decisions);pendingDecisions=decisions.length;$('review-count').textContent=String(pendingDecisions);$('review-count').hidden=!pendingDecisions;$('toggle-review').classList.toggle('needs-review',pendingDecisions>0);$('review-label').textContent=pendingDecisions?'Review':'Activity';setReviewOpen(reviewOpen);update('decisions',decisions,container=>{container.replaceChildren();container.closest('section')?.classList.toggle('has-attention',decisions.length>0);if(!decisions.length){container.append(node('p','All clear. Requests for approval appear here.','muted'));return}for(const decision of decisions){const el=node('div',undefined,'decision');el.append(node('h3',decision.kind==='question'?'A question for you':'Approve an action'));if(decision.kind==='permission'){el.append(node('p',decision.request.riskDescription||decision.request.message||'Review this action before it runs.','muted'),node('pre',JSON.stringify(decision.request,null,2)));const actions=node('div',undefined,'actions');for(const [label,answer] of [['Approve once','once'],['Decline','deny']])actions.append(button(label,()=>api('/api/decisions/'+decision.id,{fingerprint:decision.fingerprint,answer}),answer==='once'?'primary':'danger'));el.append(actions)}else if(decision.kind==='question'){const form=node('form');const questions=Array.isArray(decision.request.questions)?decision.request.questions:[];questions.forEach((q,i)=>{const label=node('label',q.question);const input=node('textarea');input.name=String(i);input.placeholder=q.placeholder||'';input.required=true;label.append(input);if(q.options)label.append(node('p',q.options.map(o=>o.label+(o.description?' — '+o.description:'')).join('\n'),'muted'));form.append(label)});const submit=node('button','Send answer','primary');submit.type='submit';form.append(submit);form.addEventListener('submit',event=>{event.preventDefault();perform(submit,()=>api('/api/decisions/'+decision.id,{fingerprint:decision.fingerprint,answer:Object.fromEntries(new FormData(form))}))});el.append(form,button('Skip question',()=>api('/api/decisions/'+decision.id,{fingerprint:decision.fingerprint,answer:null})))}else el.append(node('pre',JSON.stringify(decision.request,null,2)));container.append(el)}})}
function scheduleText(schedule){let text;if(schedule.kind==='daily')text='Daily at '+String(schedule.hour).padStart(2,'0')+':'+String(schedule.minute).padStart(2,'0')+' ('+schedule.timeZone+')';else if(schedule.kind==='interval')text='Every '+schedule.everyMs/60000+' minutes';else if(schedule.kind==='once')text=date(schedule.at);else text='On event: '+schedule.topic;return schedule.endsAt===undefined?text:text+' · through '+date(schedule.endsAt)}
function showRoutines(routines){update('routines',routines,container=>{container.replaceChildren();if(!routines.length)container.append(node('p','No routines scheduled.','muted'));for(const routine of routines){const el=node('div',undefined,'routine');el.append(node('strong',routine.name),node('p',scheduleText(routine.schedule),'muted'),node('p',routine.prompt),node('p',!routine.enabled?'Paused':routine.nextAt!==null?'Next: '+date(routine.nextAt):routine.schedule.kind==='event'?'Waiting for event: '+routine.schedule.topic:'No upcoming run','routine-next'));const actions=node('div',undefined,'actions');actions.append(button('Test safely',async()=>{const occurrenceId=crypto.randomUUID();await api('/api/bots/'+selected+'/routines/'+routine.id+'/test',{occurrenceId})}),button('Run once',async()=>{if(!window.confirm('Run this routine now? It may perform real actions and will still use the normal approval checks.'))return;let occurrenceId=routineRunKeys.get(routine.id);if(!occurrenceId){occurrenceId=crypto.randomUUID();routineRunKeys.set(routine.id,occurrenceId)}await api('/api/bots/'+selected+'/routines/'+routine.id+'/run',{occurrenceId});routineRunKeys.delete(routine.id)}),button('Edit routine',()=>openRoutine(routine)),button(routine.enabled?'Pause routine':'Enable routine',()=>api('/api/bots/'+selected+'/routines/'+routine.id,{enabled:!routine.enabled,version:routine.version})),button('Delete routine',async()=>{if(!window.confirm('Delete this schedule? Work already queued from it will continue as a separate task.'))return;await api('/api/bots/'+selected+'/routines/'+routine.id+'/delete',{version:routine.version});routineRunKeys.delete(routine.id)},'danger'));el.append(actions);const history=node('details');const summary=node('summary','Recent runs');history.append(summary);let loaded=false;history.addEventListener('toggle',async()=>{if(!history.open||loaded)return;loaded=true;try{const runs=await api('/api/bots/'+selected+'/routines/'+routine.id+'/runs');if(!history.isConnected)return;if(!runs.length)history.append(node('p','No runs recorded yet.','muted'));for(const run of runs){const item=node('div');item.append(node('p',(run.testMode?'Safe test · ':'')+run.status+' · '+date(run.createdAt),'muted'),node('p',run.prompt,'prompt'));if(run.output)item.append(node('p',run.output));if(run.error)item.append(node('p',run.error,'error'));history.append(item)}}catch(error){loaded=false;if(history.isConnected)history.append(node('p',error.message,'error'))}});el.append(history);container.append(el)}})}
function showProcedures(procedures){update('procedures',procedures,container=>{container.replaceChildren();if(!procedures.length)container.append(node('p','Learn a skill from a completed browser task.','muted'));for(const skill of procedures){const el=node('div',undefined,'routine');el.append(node('strong',skill.name),node('p',skill.status==='ready'?'Ready — every use rechecks the current page':'Needs a fresh demonstration','muted'),node('p','Observed '+date(skill.createdAt),'muted'));const link=node('a','Download SKILL.md');link.href='/api/bots/'+selected+'/procedures/'+skill.id;link.download='SKILL.md';el.append(link);container.append(el)}})}
function showNotes(notes){update('notes',notes,container=>{container.replaceChildren();if(!notes.length)container.append(node('p','The agent has no saved notes yet.','muted'));for(const note of notes){const el=node('div',undefined,'note');el.append(node('p',note.content),node('p','Source: '+note.source,'muted'),button('Edit note',()=>openNote(note)));container.append(el)}})}
function showDeliveries(targets,history){update('deliveries',{targets,history},container=>{container.replaceChildren();if(!targets.length){container.append(node('p','No outbound webhooks configured.','muted'));return}for(const target of targets){const el=node('div',undefined,'routine');el.append(node('strong',target.url),node('p',target.topics.join(', '),'muted'));const latest=history.find(item=>item.targetId===target.id);if(latest)el.append(node('p','Latest delivery: '+latest.status+' · attempt '+latest.attempt+(latest.responseStatus?' · HTTP '+latest.responseStatus:''),'muted'));const actions=node('div',undefined,'actions');actions.append(button(target.enabled?'Pause webhook':'Enable webhook',()=>api('/api/bots/'+selected+'/deliveries/'+target.id+'/enabled',{enabled:!target.enabled})));if(latest?.status==='failed')actions.append(button('Retry latest delivery',()=>api('/api/bots/'+selected+'/deliveries/'+latest.id+'/retry',{})));actions.append(button('Remove webhook',async()=>{if(!window.confirm('Remove this receiver and its pending delivery queue?'))return;await api('/api/bots/'+selected+'/deliveries/'+target.id+'/delete',{})},'danger'));el.append(actions);const key=node('details');key.append(node('summary','Receiver verification key'),node('p','Configure this public key at the receiver. Verify the signature over timestamp + "." + the exact request body. Reject old timestamps and deduplicate by delivery ID.','muted'),node('pre',target.publicKey));if(latest?.lastError)key.append(node('p',latest.lastError,'error'));el.append(key);container.append(el)}})}
function showGroups(groups){update('group-list',{groups,selectedGroup,appearance:botsState.map(bot=>({id:bot.id,appearance:bot.appearance,state:podState(bot)}))},container=>{container.replaceChildren();for(const group of groups){const el=button('',async()=>selectGroup(group.id));const team=node('span',undefined,'group-faces');for(const member of group.members.slice(0,3)){const bot=botsState.find(bot=>bot.id===member.botId)||member;team.append(avatar(bot,'reply-avatar',podState(bot)))}el.append(team,node('span',group.name));el.className='bot'+(selectedGroup===group.id?' selected':'');container.append(el)}if(!groups.length)container.append(node('p','Create a room to coordinate agents.','muted'))})}
function populateGroupRecipients(group){const container=$('group-recipients');container.replaceChildren();for(const member of group.members){const label=node('label',member.name);const input=node('input');input.type='checkbox';input.name='recipients';input.value=member.botId;input.checked=member.enabled;input.disabled=!member.enabled;label.className='member-choice';label.prepend(input,avatar(botsState.find(bot=>bot.id===member.botId)||member,'reply-avatar'));container.append(label)}}
async function selectGroup(id){
  if(selected)drafts.set(selected,{message:$('message').value,key:messageKey});
  closeDialogs();selected=null;current=null;selectedGroup=id;reviewOpen=false;setReviewOpen(false);syncGroupWorkspace();
  groupMessageKey=null;signatures.delete('group-transcript');signatures.delete('group-artifacts');$('group-message-form').reset();$('group-message-form').dataset.groupId='';$('group-message-form').querySelector('.error').textContent='';$('group-artifacts').hidden=true;$('group-library').setAttribute('aria-expanded','false');await refreshGroup(id);showBots(botsState)
}
async function refreshGroup(id){const epoch=authEpoch,data=await api('/api/groups/'+encodeURIComponent(id));if(selectedGroup!==id||epoch!==authEpoch)return;const group=data.group;$('group-title').textContent=group.name;$('group-description').textContent='Members: '+group.members.map(member=>member.name).join(', ')+(group.shareBrowser?' · shared Codimium browser, queued one task at a time':' · private browser profiles');populateGroupRecipientsIfNeeded(group);const memberNames=new Map(group.members.map(member=>[member.botId,member.name]));update('group-transcript',{messages:data.messages,runs:data.runs,appearance:botsState.map(bot=>({id:bot.id,appearance:bot.appearance,enabled:bot.enabled}))},container=>{const bottom=container.scrollHeight-container.scrollTop-container.clientHeight<80,scroll=container.scrollTop;container.replaceChildren();if(!data.messages.length)container.append(node('p','No messages yet.','muted'));for(const message of data.messages){const entry=node('div',undefined,'group-message'),sender=message.sender==='user'?'You':memberNames.get(message.botId)||'Former member';if(message.sender!=='user'){const bot=botsState.find(bot=>bot.id===message.botId)||{name:sender};entry.append(avatar(bot,'reply-avatar',podState(bot)))}const content=node('div',undefined,'group-message-content');content.append(node('strong',sender),node('time',date(message.createdAt)),node('p',message.content));entry.append(content);if(message.sender==='user'){const runs=data.runs.filter(run=>run.groupMessageId===message.id);if(runs.length){const statuses=node('div',undefined,'group-members');for(const run of runs){const member=group.members.find(item=>item.botId===run.botId);statuses.append(node('span',(member?.name||'Agent')+': '+run.status,'muted'));if(['blocked','failed'].includes(run.status))statuses.append(button('Review '+(member?.name||'agent'),async()=>{selectBot(run.botId);await refresh()}))}content.append(statuses)}}container.append(entry)}container.scrollTop=bottom?container.scrollHeight:scroll});update('group-artifacts',data.artifacts,container=>{container.replaceChildren();if(!data.artifacts.length)container.append(node('p','Files your teammates share will appear here.','muted'));for(const artifact of data.artifacts){const details=node('details'),summary=node('summary',artifact.name+' · v'+artifact.version);details.append(summary,node('p','Updated '+date(artifact.updatedAt),'muted'));let loaded=false;details.addEventListener('toggle',async()=>{if(!details.open||loaded)return;loaded=true;try{const value=await api('/api/groups/'+encodeURIComponent(id)+'/artifacts/'+encodeURIComponent(artifact.name));if(details.isConnected)details.append(node('pre',value.content),button('Download file',()=>downloadText(artifact.name,value.content)))}catch(error){loaded=false;if(details.isConnected)details.append(node('p',error.message,'error'))}});container.append(details)}})}
function populateGroupRecipientsIfNeeded(group){const form=$('group-message-form');const signature=JSON.stringify(group.members);if(form.dataset.groupId===group.id&&form.dataset.members===signature)return;const chosen=new Set([...form.querySelectorAll('input:checked')].map(input=>input.value)),same=form.dataset.groupId===group.id;form.dataset.groupId=group.id;form.dataset.members=signature;populateGroupRecipients(group);if(same)for(const input of form.querySelectorAll('input'))input.checked=chosen.has(input.value)&&!input.disabled}
async function refreshGroups(epoch){const data=await api('/api/groups');if(epoch!==authEpoch)return;showGroups(data.groups);if(!selectedGroup)return;if(!data.groups.some(group=>group.id===selectedGroup)){selectedGroup=null;syncGroupWorkspace();signatures.delete('group-transcript');signatures.delete('group-artifacts');return}await refreshGroup(selectedGroup)}
function openNote(note){noteEdit=note||null;const form=$('note-form');form.reset();form.querySelector('.error').textContent='';form.elements.content.value=note?.content||'';form.elements.source.value=note?.source||'user:panel';form.elements.expiresAt.value=note?.expiresAt===null||!note?'':new Date(note.expiresAt-new Date(note.expiresAt).getTimezoneOffset()*60000).toISOString().slice(0,-1);$('remove-note').hidden=!note;$('note-dialog').showModal()}
async function refresh(){if(refreshing)return;refreshing=true;const epoch=authEpoch;try{const state=await api('/api/bots');if(epoch!==authEpoch)return;authenticated=true;$('login').hidden=true;$('app').hidden=false;$('connection').textContent='Connected';$('connection').dataset.state='online';if(!selectedGroup&&!state.bots.some(b=>b.id===selected)){const next=state.bots[0]?.id||null;if(next!==selected)selectBot(next)}showBots(state.bots);await refreshGroups(epoch);if(epoch!==authEpoch)return;if(selectedGroup){setReviewOpen(false);syncGroupWorkspace();return}$('composer').hidden=!selected;$('toggle-bot').hidden=!selected;$('new-routine').hidden=!selected;$('export-bot').hidden=!selected;$('delete-bot').hidden=!selected;$('new-delivery').hidden=!selected;$('history-section').hidden=!selected;browserOpen.hidden=!selected;$('new-note').hidden=!selected;if(!selected){showNoAgents();return}const id=selected;const data=await api('/api/bots/'+id);if(id!==selected||epoch!==authEpoch)return;current=data;markSeen(state.bots.find(bot=>bot.id===id)||data.bot);showBots(state.bots);showLibrary(data.runs);$('bot-name').textContent=data.bot.name;const agentState=podState(data.bot,data.runs);setAvatar($('bot-avatar'),data.bot,agentState);$('agent-state').textContent=agentState;$('agent-state').dataset.state=agentState;$('responsibility').textContent=data.bot.instructions;$('toggle-bot').textContent=data.bot.enabled?'Pause new work':'Enable agent';showRuns(data.runs,data.unreconciledRuns,data.guidance,data.legacyTranscript);showDecisions(data.decisions);showRoutines(data.routines);showNotes(data.notes);showProcedures(data.procedures);const deliveryData=await api('/api/bots/'+id+'/deliveries');if(id!==selected||epoch!==authEpoch)return;showDeliveries(deliveryData.targets,deliveryData.history);const events=await api('/api/bots/'+id+'/events?after='+eventCursor);if(id!==selected||epoch!==authEpoch)return;if(events.length){eventCursor=events.at(-1).event_seq;eventItems.push(...events);eventItems=eventItems.slice(-80);const container=$('activity-list');container.replaceChildren();for(const event of eventItems){const el=node('div');el.append(node('strong',event.type),node('p',date(event.created_at),'muted'));const details=node('details');details.append(node('summary','Details'),node('pre',JSON.stringify(event.payload,null,2)));el.append(details);container.append(el)}}}catch(error){if(authenticated){$('connection').textContent='Connection interrupted';$('connection').dataset.state='offline';notify(error.message+' Your queued tasks remain saved.')}}finally{refreshing=false}}
$('history-search-form').addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget,control=submitter(event),query=String(new FormData(form).get('query')||'').trim(),botId=selected,epoch=authEpoch;control.disabled=true;form.querySelector('.error').textContent='';try{if(!botId)throw new Error('Select an agent first');const results=await api('/api/bots/'+encodeURIComponent(botId)+'/history?query='+encodeURIComponent(query));if(botId===selected&&epoch===authEpoch)showHistory(results)}catch(error){form.querySelector('.error').textContent=error.message}finally{control.disabled=false}});
$('login-form').addEventListener('submit',async event=>{event.preventDefault();const submit=submitter(event);submit.disabled=true;try{await api('/api/login',{token:$('token').value});$('token').value='';$('login-error').textContent='';await refresh()}catch(error){$('login-error').textContent=error.message}finally{submit.disabled=false}});
$('logout').addEventListener('click',async()=>{try{await api('/api/logout',{});signOut();notify('')}catch(error){notify(error.message)}});
$('toggle-review').addEventListener('click',()=>setReviewOpen(!reviewOpen,'activity'));
for(const tab of document.querySelectorAll('[data-workspace-view]'))tab.addEventListener('click',()=>setReviewOpen(tab.dataset.workspaceView!=='conversation',tab.dataset.workspaceView==='conversation'?'activity':tab.dataset.workspaceView));
$('pod-search').addEventListener('input',()=>showBots(botsState));
$('theme-toggle').addEventListener('click',()=>{const light=document.documentElement.dataset.theme!=='light';document.documentElement.dataset.theme=light?'light':'dark';$('theme-toggle').textContent=light?'Dark':'Light';$('theme-toggle').setAttribute('aria-label','Switch to '+(light?'dark':'light')+' theme')});
$('close-review').addEventListener('click',()=>{setReviewOpen(false);$('toggle-review').focus()});

$('new-group').addEventListener('click',()=>{const form=$('group-create-form'),container=$('group-create-members');form.reset();form.querySelector('.error').textContent='';container.replaceChildren();for(const bot of botsState.filter(item=>item.enabled)){const label=node('label',bot.name);const input=node('input');input.type='checkbox';input.name='botIds';input.value=bot.id;label.prepend(input);container.append(label)}if(container.childElementCount<2)container.append(node('p','Enable at least two agents before creating a group.','muted'));$('group-create-dialog').showModal()});
$('group-create-form').addEventListener('submit',event=>submitForm(event,async fields=>{const group=await api('/api/groups',{name:fields.get('name'),botIds:fields.getAll('botIds'),shareBrowser:fields.get('shareBrowser')==='on'});await selectGroup(group.id)}));
$('group-message-form').addEventListener('input',()=>{groupMessageKey=null});
$('group-message-form').addEventListener('submit',event=>submitForm(event,async fields=>{if(!selectedGroup)throw new Error('Select a collaboration group first');groupMessageKey??=crypto.randomUUID();const id=selectedGroup,message=fields.get('message');await api('/api/groups/'+encodeURIComponent(id)+'/messages',{message,messageId:groupMessageKey,recipients:fields.getAll('recipients')});if(selectedGroup===id){if($('group-message-form').elements.message.value===message)$('group-message-form').elements.message.value='';groupMessageKey=null}}));
$('delete-group').addEventListener('click',event=>perform(event.currentTarget,async()=>{if(!selectedGroup)return;const group=await api('/api/groups/'+encodeURIComponent(selectedGroup));const typed=window.prompt('This permanently deletes '+group.group.name+' including its shared messages, artifacts and group browser profile. Type the exact group name to continue.');if(typed!==group.group.name)return;await api('/api/groups/'+encodeURIComponent(selectedGroup)+'/delete',{confirmation:typed});selectedGroup=null;syncGroupWorkspace();signatures.delete('group-list')}));
const toneColors=${JSON.stringify(POD_TONE_COLORS)};
const appearanceLabels={'cap':'Beret','bucket-hat':'Bucket hat','bowtie':'Bow tie'};
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
function openCreate(){const form=$('create-form');form.reset();form.querySelector('.error').textContent='';const defaults=defaultAppearance('Pod');for(const [key,value] of Object.entries(defaults))form.elements.namedItem('appearance:'+key).value=value;previewAppearance('create-avatar-preview',form,'Your new Pod','appearance:');window.Pod3D.reset($('create-avatar-preview').querySelector('.editor-avatar'));$('create-dialog').showModal()}
$('new-bot').addEventListener('click',openCreate);
$('create-form').addEventListener('input',()=>previewAppearance('create-avatar-preview',$('create-form'),$('create-form').elements.name.value||'Your new Pod','appearance:'));
const appearanceSection=node('section');appearanceSection.dataset.view='profile';appearanceSection.append(node('h2','Appearance'),node('p','A familiar face in every conversation.','muted'),button('Customize Pod',()=>{if(!current)return;const form=$('appearance-form');form.reset();form.querySelector('.error').textContent='';for(const [key,value] of Object.entries(podAppearance(current.bot)))form.elements.namedItem(key).value=value;previewAppearance('appearance-preview',form,current.bot.name);window.Pod3D.reset($('appearance-preview').querySelector('.editor-avatar'));$('appearance-dialog').showModal()}));$('review-panel').querySelector('section').before(appearanceSection);
$('appearance-form').addEventListener('input',()=>previewAppearance('appearance-preview',$('appearance-form'),current?.bot.name));
$('appearance-form').addEventListener('submit',event=>submitForm(event,()=>api('/api/bots/'+selected+'/appearance',{appearance:formAppearance($('appearance-form'))})));
for(const control of document.querySelectorAll('[data-close]'))control.addEventListener('click',()=>control.closest('dialog').close());
async function submitForm(event,action){event.preventDefault();const form=event.currentTarget,control=submitter(event);control.disabled=true;try{await action(new FormData(form));form.closest('dialog')?.close();if(form.id!=='group-message-form')form.reset();form.querySelector('.error').textContent='';await refresh()}catch(error){form.querySelector('.error').textContent=error.message}finally{control.disabled=false}}
const reviewerCreateLabel=node('label','Completion reviewer model (optional)');const reviewerCreateInput=document.createElement('input');reviewerCreateInput.name='reviewerModel';reviewerCreateInput.maxLength=128;reviewerCreateInput.pattern='[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}';reviewerCreateInput.placeholder='Use the pod model';reviewerCreateLabel.append(reviewerCreateInput,node('span','The completion check always runs. Leave blank to use this pod’s main model.','muted'));$('create-form').elements.agentConfig.closest('label').after(reviewerCreateLabel);
$('create-form').addEventListener('submit',event=>submitForm(event,async fields=>{const input=Object.fromEntries(fields);input.appearance=formAppearance($('create-form'),'appearance:');for(const key of Object.keys(appearanceOptions))delete input['appearance:'+key];if(!input.agentConfig)delete input.agentConfig;if(!input.reviewerModel)delete input.reviewerModel;const bot=await api('/api/bots',input);selectBot(bot.id)}));
$('composer').addEventListener('submit',event=>{event.preventDefault();const id=selected,message=$('message').value,control=submitter(event);messageKey??=crypto.randomUUID();const occurrenceId=messageKey;perform(control,async()=>{await api('/api/bots/'+id+'/messages',{message,occurrenceId});if(selected===id){if($('message').value===message)$('message').value='';messageKey=null}else if(drafts.get(id)?.message===message)drafts.delete(id)})});
$('message').addEventListener('input',()=>{messageKey=null});
$('message').addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();const control=$('composer').querySelector('button[type=submit]');if(!control.disabled&&$('message').value.trim())$('composer').requestSubmit(control)}});
$('toggle-bot').addEventListener('click',event=>perform(event.currentTarget,()=>api('/api/bots/'+selected+'/enabled',{enabled:!current.bot.enabled})));
$('export-bot').addEventListener('click',()=>{if(!selected)return;const link=document.createElement('a');link.href='/api/bots/'+encodeURIComponent(selected)+'/export';link.download='deepseek-bot-'+selected+'.json';link.click()});
$('delete-bot').addEventListener('click',async event=>{if(!current)return;const bot=current.bot,typed=window.prompt('This permanently deletes '+bot.name+' and its saved history, agent state and Codimium profile. Project files are kept. Type the exact agent name to continue.');if(typed!==bot.name)return;await perform(event.currentTarget,async()=>{await api('/api/bots/'+encodeURIComponent(bot.id)+'/delete',{confirmation:typed});drafts.delete(bot.id);selected=null;current=null;signatures.clear()})});
function scheduleFields(){const kind=$('routine-form').elements.kind.value;for(const section of document.querySelectorAll('[data-schedule]')){section.hidden=section.dataset.schedule==='recurring'?kind==='once':section.dataset.schedule!==kind;for(const input of section.querySelectorAll('input'))input.required=!section.hidden&&input.name!=='endsAt'}}
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
$('routine-form').addEventListener('input',()=>{if(!routineEdit)routineKey=crypto.randomUUID()});
$('routine-form').addEventListener('submit',event=>submitForm(event,async fields=>{const kind=fields.get('kind');let schedule;if(kind==='daily'){const [hour,minute]=fields.get('time').split(':').map(Number);schedule={kind,hour,minute,timeZone:fields.get('timeZone')}}else if(kind==='interval')schedule={kind,everyMs:Number(fields.get('minutes'))*60000};else if(kind==='once')schedule={kind,at:new Date(fields.get('at')).getTime()};else schedule={kind,topic:fields.get('topic')};if(kind!=='once'&&fields.get('endsAt'))schedule.endsAt=new Date(fields.get('endsAt')).getTime();const procedureId=fields.get('procedureId'),payload={name:fields.get('name'),prompt:fields.get('prompt'),schedule,...(procedureId?{procedureId,procedureInputs:Object.fromEntries([...fields].filter(([key])=>key.startsWith('procedure:')).map(([key,value])=>[key.slice(10),value]))}:{})};if(routineEdit){await api('/api/bots/'+selected+'/routines/'+routineEdit.id,{...payload,procedureId:procedureId||null,version:routineEdit.version});routineEdit=null}else{await api('/api/bots/'+selected+'/routines',{...payload,occurrenceId:routineKey});routineKey=null}}));
$('reconcile-form').addEventListener('submit',event=>submitForm(event,fields=>api('/api/runs/'+reviewRun+'/reconcile',{evidence:fields.get('evidence')})));
const browserOpen=button('Open computer',async()=>{const epoch=authEpoch,id=selected;const state=await browserStatus();if(epoch!==authEpoch||id!==selected)return;setReviewOpen(false);$('computer-title').textContent=current.bot.name+'’s computer';$('browser-dialog').show();$('app-layout').classList.add('with-computer');if(state.runId&&state.contexts.some(context=>context.tabs.length))await browserImage()},'browser-control');browserOpen.hidden=true;document.querySelector('.agent-actions').append(browserOpen);
const retentionLabel=node('label','Automatically remove completed run history after');const retentionSelect=node('select');retentionSelect.id='retention-days';for(const [value,label] of [['never','Keep indefinitely'],['30','30 days'],['90','90 days'],['180','180 days'],['365','1 year'],['730','2 years']])retentionSelect.append(new Option(label,value));retentionLabel.append(retentionSelect);const retentionHelp=node('p','Runs with uncertain effects or used to create browser skills are kept for review.');retentionHelp.className='muted';$('export-bot').closest('section').insertBefore(retentionLabel,$('export-bot').closest('.actions'));$('export-bot').closest('section').insertBefore(retentionHelp,$('export-bot').closest('.actions'));const previousRefresh=refresh;refresh=async()=>{await previousRefresh();if(current){const days=current.bot.retentionDays===null?'never':String(current.bot.retentionDays);if(!Array.from(retentionSelect.options).some(option=>option.value===days))retentionSelect.add(new Option(days+' days',days));retentionSelect.value=days}};retentionSelect.addEventListener('change',event=>perform(retentionSelect,async()=>{const days=retentionSelect.value==='never'?null:Number(retentionSelect.value);await api('/api/bots/'+selected+'/retention',{days})}));
function syncBrowserControls(){const held=$('browser-dialog').dataset.held==='true';$('browser-take').disabled=!browserRun||held;$('browser-release').disabled=!browserRun||!held;for(const control of document.querySelectorAll('#browser-navigation input,#browser-navigation button,#browser-text input,#browser-text button,#browser-key,#browser-press,#browser-up,#browser-down,#browser-accept,#browser-dismiss,#browser-tab'))control.disabled=!browserRun||!held;$('browser-image').tabIndex=held?0:-1}
async function browserStatus(){const epoch=authEpoch,id=selected;const state=await api('/api/bots/'+id+'/browser');if(epoch!==authEpoch||id!==selected)throw new Error('The selected Pod changed. Open its computer again.');browserRun=state.runId;$('browser-state').textContent=!state.runId?'This Pod has no active task. Send a task to start its computer.':state.held?'You have control. Return it when you finish.':'Watching '+(current?.bot.name||'your Pod')+' work. Take over when you need to interact.';browserOpen.textContent=state.held?'Computer · you have control':'Open computer';$('browser-dialog').dataset.held=String(state.held);syncBrowserControls();if(!state.runId){browserView=null;$('browser-image').removeAttribute('src');$('browser-image').hidden=true}const tabSelect=$('browser-tab');tabSelect.replaceChildren();const main=state.contexts.find(context=>context.key.endsWith('|main'));if(main){main.tabs.forEach((tab,index)=>{const option=node('option',index+': '+(tab.title||tab.url));option.value=index;tabSelect.append(option)});tabSelect.value=main.active}return state}

let reviewerDirtyFor = null;const reviewerSection=node('section'),reviewerTitle=node('h2','Completion review'),reviewerInfo=node('p','The completion check is mandatory. Choose a model supported by this pod’s provider, or leave blank to inherit its active model. If review cannot run, the goal stays active.','muted'),reviewerForm=document.createElement('form'),reviewerModelLabel=node('label','Reviewer model'),reviewerModelInput=document.createElement('input'),reviewerHelp=node('p','Leave blank to use the pod model. Changes apply to new runs; active runs keep their starting setting.','muted'),reviewerError=node('p'),reviewerSave=document.createElement('button');reviewerSection.dataset.view='profile';reviewerSection.append(reviewerTitle,reviewerInfo);reviewerForm.id='reviewer-model-form';reviewerModelInput.id='reviewer-model';reviewerModelInput.name='model';reviewerModelInput.maxLength=128;reviewerModelInput.pattern='[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}';reviewerModelInput.placeholder='Use pod model';reviewerModelLabel.append(reviewerModelInput);reviewerError.className='error';reviewerError.setAttribute('role','alert');reviewerSave.type='submit';reviewerSave.className='primary';reviewerSave.textContent='Save reviewer model';reviewerForm.append(reviewerModelLabel,reviewerHelp,reviewerSave,reviewerError);reviewerSection.append(reviewerForm);reviewerSection.hidden=true;$('history-section').before(reviewerSection);reviewerModelInput.addEventListener('input',()=>{reviewerDirtyFor=selected});reviewerForm.addEventListener('submit',event=>{event.preventDefault();const control=submitter(event),podId=selected;control.disabled=true;reviewerError.textContent='';void api('/api/bots/'+encodeURIComponent(podId)+'/reviewer-model',{model:reviewerModelInput.value.trim()||null}).then(()=>{if(reviewerDirtyFor===podId)reviewerDirtyFor=null;notify('Completion reviewer saved.');return refresh()}).catch(error=>{reviewerError.textContent=error.message}).finally(()=>{control.disabled=false})});const refreshWithReviewer=refresh;refresh=async()=>{await refreshWithReviewer();reviewerSection.hidden=!selected;if(current&&reviewerDirtyFor!==selected&&document.activeElement!==reviewerModelInput){reviewerModelInput.value=current.bot.reviewerModel||'';reviewerDirtyFor=null}};
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
