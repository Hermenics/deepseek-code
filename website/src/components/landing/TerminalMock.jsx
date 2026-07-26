import React, { useEffect, useRef, useCallback, useState } from "react";

const SCENES = [
  { id: "welcome", startTime: 0, duration: 2000, type: "welcome" },
  { id: "input-border-top", startTime: 2000, duration: 200, type: "instant",
    render: () => '\n<span class="tm-dim">──────────────────────────────────────────────────────────────────────────────────────────</span> <span class="tm-green">Build</span>  <span class="tm-dim">deepseek</span>\n' },
  { id: "input-border-bottom", startTime: 2100, duration: 200, type: "input-box-bottom" },
  { id: "user-input", startTime: 2300, duration: 4500, type: "typing", speed: 18,
    prefix: '<span class="tm-cyan">❯</span> ',
    text: "Build a full-stack web app using Python (FastAPI) and HTML/JS. It should allow users to upload a CSV file, process the data to calculate the average of a specific numeric column, and display the result on the screen along with a simple chart." },
  { id: "spinner-thinking", startTime: 6900, duration: 1800, type: "spinner",
    frames: ["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"],
    text: "Consulting the code gods...", cancelHint: "Ctrl+C to cancel" },
  { id: "thinking-block", startTime: 8700, duration: 1500, type: "thinking", speed: 8,
    text: "I'll build a FastAPI backend with a CSV upload endpoint that calculates column averages, and a frontend with Chart.js for visualization. Two files: main.py and templates/index.html." },
  { id: "assistant-plan", startTime: 10200, duration: 3500, type: "assistant-stream", speed: 12,
    lines: [
      { type: "bullet-main", text: "I'll create a full-stack CSV analyzer with:" },
      { type: "empty" },
      { type: "bullet", text: "**FastAPI** backend with file upload + pandas for processing" },
      { type: "bullet", text: "**Chart.js** frontend for column visualization" },
      { type: "bullet", text: "Auto-detection of numeric columns" },
      { type: "bullet", text: "Clean single-page UI with drag-and-drop upload" },
      { type: "empty" },
      { type: "text", text: "Let me set this up for you." }
    ] },
  { id: "tool-write-main", startTime: 13700, duration: 800, type: "tool-running", text: "Write main.py", color: "green" },
  { id: "diff-main", startTime: 14500, duration: 3000, type: "diff", speed: 6,
    header: "Write main.py", info: "+42 / -0 at L1 in main.py",
    lines: [
      "from fastapi import FastAPI, UploadFile, File",
      "from fastapi.responses import HTMLResponse",
      "from fastapi.staticfiles import StaticFiles",
      "from fastapi.templating import Jinja2Templates",
      "import pandas as pd",
      "import io",
      "",
      "app = FastAPI()",
      'templates = Jinja2Templates(directory="templates")',
      "",
      '@app.get("/", response_class=HTMLResponse)',
      "async def home(request):",
      '    return templates.TemplateResponse("index.html", {"request": request})',
      "",
      '@app.post("/upload")',
      "async def upload_csv(file: UploadFile = File(...)):",
      "    contents = await file.read()",
      '    df = pd.read_csv(io.StringIO(contents.decode("utf-8")))',
      '    numeric_cols = df.select_dtypes(include="number").columns.tolist()',
      "    averages = {col: round(df[col].mean(), 2) for col in numeric_cols}",
      '    return {"columns": numeric_cols, "averages": averages,',
      '            "row_count": len(df)}'
    ] },
  { id: "tool-write-html", startTime: 17500, duration: 800, type: "tool-running", text: "Write templates/index.html", color: "green" },
  { id: "diff-html", startTime: 18300, duration: 2800, type: "diff", speed: 6,
    header: "Write templates/index.html", info: "+58 / -0 at L1 in index.html",
    lines: [
      "<!DOCTYPE html>",
      '<html lang="en">',
      "<head>",
      "  <title>CSV Analyzer</title>",
      '  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>',
      "  <style>",
      "    body { font-family: system-ui; max-width: 800px; margin: 2rem auto; }",
      "    .drop-zone { border: 2px dashed #ccc; padding: 3rem; text-align: center; }",
      "    .drop-zone.dragover { border-color: #00cccc; background: #f0fffe; }",
      "    canvas { max-height: 400px; margin-top: 2rem; }",
      "  </style>",
      "</head>",
      "<body>",
      '  <h1>📊 CSV Column Averages</h1>',
      '  <div class="drop-zone" id="dropZone">',
      '    <p>Drop CSV here or <input type="file" accept=".csv" id="fileInput"></p>',
      "  </div>",
      '  <canvas id="chart"></canvas>',
      '  <script src="/static/app.js"></script>',
      "</body></html>"
    ] },
  { id: "tool-bash-install", startTime: 21100, duration: 600, type: "tool-running", text: "$ pip install fastapi uvicorn pandas python-multipart jinja2", color: "purple" },
  { id: "bash-install-result", startTime: 21700, duration: 1500, type: "bash-result", speed: 10,
    command: "pip install fastapi uvicorn pandas python-multipart jinja2",
    lines: [ "Successfully installed fastapi-0.115.0 uvicorn-0.30.0 pandas-2.2.2", "python-multipart-0.0.9 jinja2-3.1.4" ] },
  { id: "tool-bash-run", startTime: 23200, duration: 600, type: "tool-running", text: "$ uvicorn main:app --reload --port 8000", color: "purple" },
  { id: "bash-run-result", startTime: 23800, duration: 1200, type: "bash-result", speed: 10,
    command: "uvicorn main:app --reload --port 8000",
    lines: [ "INFO:     Uvicorn running on http://127.0.0.1:8000", "INFO:     Started reloader process [12847]" ] },
  { id: "assistant-summary", startTime: 25000, duration: 4000, type: "assistant-stream", speed: 10,
    lines: [
      { type: "bullet-main", text: "Done! Your CSV analyzer is live at **http://localhost:8000**" },
      { type: "empty" },
      { type: "text", text: "Here's what I built:" },
      { type: "empty" },
      { type: "bullet", text: "`main.py` — FastAPI server with `/upload` endpoint, uses pandas to detect numeric columns and compute averages" },
      { type: "bullet", text: "`templates/index.html` — Drag-and-drop UI with **Chart.js** bar chart showing per-column averages" },
      { type: "empty" },
      { type: "text", text: "Upload any CSV and it'll auto-detect numeric columns, calculate their means, and render a chart. The server is running with hot-reload enabled." }
    ] },
  { id: "statusbar", startTime: 29000, duration: 1000, type: "instant",
    render: () => '\n<span class="tm-dim">───────────────────────────────────────────────────────────────────</span>\n<span class="tm-green">Build</span> · <span class="tm-cyan">◈ deepseek-chat</span> · <span class="tm-dim">ℹ 2,847 tokens</span> · <span class="tm-dim">⎇ main</span> · <span class="tm-dim">ctx 8%</span>' }
];

function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function formatAssistantText(text) {
  let result = escapeHtml(text);
  result = result.replace(/\*\*(.+?)\*\*/g, '<span class="tm-bold">$1</span>');
  result = result.replace(/`(.+?)`/g, '<span class="tm-code">$1</span>');
  return result;
}

export default function TerminalMock() {
  const outputRef = useRef(null);
  const [fontScale, setFontScale] = useState(100);
  const stateRef = useRef({ startTime: 0, activeScenes: new Set(), completedScenes: new Set(), spinnerEl: null, cursorEl: null, inputAreaEl: null, inputBottomEl: null, animationId: null, intervals: [] });

  const scrollToBottom = useCallback(() => {
    const body = outputRef.current?.parentElement;
    if (body) body.scrollTop = body.scrollHeight;
  }, []);

  const removeCursor = useCallback(() => {
    const s = stateRef.current;
    if (s.cursorEl?.parentNode) { s.cursorEl.remove(); s.cursorEl = null; }
  }, []);

  const cleanup = useCallback(() => {
    const s = stateRef.current;
    if (s.animationId) cancelAnimationFrame(s.animationId);
    s.intervals.forEach(clearInterval);
    s.intervals = [];
    s.activeScenes.clear();
    s.completedScenes.clear();
    if (outputRef.current) outputRef.current.innerHTML = '';
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [fontScale, scrollToBottom]);

  const playWelcome = useCallback((scene) => {
    const s = stateRef.current;
    removeCursor();
    const mascot = `  ▄▄███▄▄\n ▄█ ◉    ██▄`;
    const mascot2 = `█          ~~█`;
    const mascot3 = ` ▀▄▄█▄▄▄▄█▀`;
    const html = `<span class="tm-cyan">${escapeHtml(mascot)}</span>     <span class="tm-cyan">◈ DeepSeek Code v0.1.1</span> <span class="tm-dim">· deepseek</span>\n<span class="tm-cyan">${escapeHtml(mascot2)}</span>    <span class="tm-dim">cwd: ~/csv-app</span>\n<span class="tm-cyan">${escapeHtml(mascot3)}</span>     <span class="tm-dim">/help for commands  ·  /quit to exit</span>\n`;
    outputRef.current.innerHTML = html;
    scrollToBottom();
    s.completedScenes.add(scene.id);
  }, [removeCursor, scrollToBottom]);

  const playInstant = useCallback((scene) => {
    const s = stateRef.current;
    removeCursor();
    if (s.spinnerEl) { s.spinnerEl.remove(); s.spinnerEl = null; }
    outputRef.current.insertAdjacentHTML('beforeend', scene.render());
    scrollToBottom();
    s.completedScenes.add(scene.id);
  }, [removeCursor, scrollToBottom]);

  const playInputBoxBottom = useCallback((scene) => {
    const s = stateRef.current;
    removeCursor();
    s.inputBottomEl = document.createElement('div');
    s.inputBottomEl.innerHTML = '<span class="tm-dim">──────────────────────────────────────────────────────────────────────────────────────────────────────</span>';
    s.inputAreaEl = document.createElement('div');
    outputRef.current.appendChild(s.inputAreaEl);
    outputRef.current.appendChild(s.inputBottomEl);
    scrollToBottom();
    s.completedScenes.add(scene.id);
  }, [removeCursor, scrollToBottom]);

  const playTyping = useCallback((scene) => {
    const s = stateRef.current;
    removeCursor();
    const container = document.createElement('span');
    container.innerHTML = scene.prefix;
    const target = s.inputAreaEl || outputRef.current;
    target.appendChild(container);
    s.cursorEl = document.createElement('span');
    s.cursorEl.className = 'tm-cursor';
    target.appendChild(s.cursorEl);
    let i = 0;
    const interval = setInterval(() => {
      if (i < scene.text.length) {
        removeCursor();
        container.insertAdjacentHTML('beforeend', escapeHtml(scene.text[i]));
        s.cursorEl = document.createElement('span');
        s.cursorEl.className = 'tm-cursor';
        target.appendChild(s.cursorEl);
        scrollToBottom();
        i++;
      } else {
        clearInterval(interval);
        removeCursor();
        s.completedScenes.add(scene.id);
      }
    }, scene.speed);
    s.intervals.push(interval);
  }, [removeCursor, scrollToBottom]);

  const playSpinner = useCallback((scene) => {
    const s = stateRef.current;
    removeCursor();
    s.spinnerEl = document.createElement('div');
    let frameIdx = 0;
    s.spinnerEl.innerHTML = `<span class="tm-cyan">${scene.frames[0]}</span> <span class="tm-dim">${escapeHtml(scene.text)}</span>  <span class="tm-dim">·  ${scene.cancelHint}</span>`;
    outputRef.current.appendChild(s.spinnerEl);
    scrollToBottom();
    const spinInterval = setInterval(() => {
      frameIdx = (frameIdx + 1) % scene.frames.length;
      const spinChar = s.spinnerEl?.querySelector('.tm-cyan');
      if (spinChar) spinChar.textContent = scene.frames[frameIdx];
    }, 80);
    s.intervals.push(spinInterval);
    setTimeout(() => {
      clearInterval(spinInterval);
      if (s.spinnerEl?.parentNode) { s.spinnerEl.remove(); s.spinnerEl = null; }
      s.completedScenes.add(scene.id);
    }, scene.duration);
  }, [removeCursor, scrollToBottom]);

  const playThinking = useCallback((scene) => {
    const s = stateRef.current;
    removeCursor();
    const block = document.createElement('div');
    block.className = 'tm-thinking-block';
    block.innerHTML = '<div class="tm-thinking-label">◌ thinking</div><div class="tm-thinking-content"></div>';
    outputRef.current.appendChild(block);
    scrollToBottom();
    const contentEl = block.querySelector('.tm-thinking-content');
    let i = 0;
    const interval = setInterval(() => {
      if (i < scene.text.length) {
        contentEl.textContent += scene.text[i];
        scrollToBottom();
        i++;
      } else {
        clearInterval(interval);
        s.completedScenes.add(scene.id);
      }
    }, scene.speed);
    s.intervals.push(interval);
  }, [removeCursor, scrollToBottom]);

  const playAssistant = useCallback((scene) => {
    const s = stateRef.current;
    removeCursor();
    const container = document.createElement('div');
    container.style.marginTop = '8px';
    outputRef.current.appendChild(container);
    let fullText = '';
    for (const line of scene.lines) {
      if (line.type === 'empty') fullText += '\n';
      else if (line.type === 'bullet-main') fullText += '● ' + line.text + '\n';
      else if (line.type === 'bullet') fullText += '• ' + line.text + '\n';
      else fullText += line.text + '\n';
    }
    let i = 0;
    const interval = setInterval(() => {
      if (i < fullText.length) {
        i = Math.min(i + 2, fullText.length);
        let rendered = fullText.substring(0, i);
        rendered = formatAssistantText(rendered);
        rendered = rendered.replace(/^(●)/gm, '<span class="tm-bold">●</span>');
        rendered = rendered.replace(/^(•)/gm, '<span class="tm-cyan">•</span>');
        container.innerHTML = rendered;
        scrollToBottom();
      } else {
        clearInterval(interval);
        s.completedScenes.add(scene.id);
      }
    }, scene.speed);
    s.intervals.push(interval);
  }, [removeCursor, scrollToBottom]);

  const playToolRunning = useCallback((scene) => {
    const s = stateRef.current;
    removeCursor();
    const el = document.createElement('div');
    el.style.marginTop = '6px';
    const colorClass = scene.color === 'purple' ? 'tm-purple' : 'tm-green';
    const icon = scene.color === 'purple' ? '$' : '▸';
    el.innerHTML = `<span class="${colorClass}">${icon}</span> <span class="tm-dim">${escapeHtml(scene.text)}</span>`;
    const spinFrames = ["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"];
    let fi = 0;
    const spinner = document.createElement('span');
    spinner.className = 'tm-cyan';
    spinner.style.marginLeft = '8px';
    spinner.textContent = spinFrames[0];
    el.appendChild(spinner);
    outputRef.current.appendChild(el);
    scrollToBottom();
    const spinInt = setInterval(() => {
      fi = (fi + 1) % spinFrames.length;
      spinner.textContent = spinFrames[fi];
    }, 80);
    s.intervals.push(spinInt);
    setTimeout(() => {
      clearInterval(spinInt);
      el.remove();
      s.completedScenes.add(scene.id);
    }, scene.duration);
  }, [removeCursor, scrollToBottom]);

  const playDiff = useCallback((scene) => {
    const s = stateRef.current;
    removeCursor();
    const container = document.createElement('div');
    container.style.marginTop = '4px';
    let html = `<span class="tm-green">✓</span> <span class="tm-diff-header">${escapeHtml(scene.header)}</span>\n<span class="tm-diff-info">    ${escapeHtml(scene.info)}</span>\n\n`;
    for (let i = 0; i < scene.lines.length; i++) {
      const lineNum = String(i + 1).padStart(3, ' ');
      html += `<span class="tm-diff-line"><span class="tm-dim">${lineNum}</span> <span class="tm-green">+</span> ${escapeHtml(scene.lines[i])}\n</span>`;
    }
    container.innerHTML = html;
    outputRef.current.appendChild(container);
    scrollToBottom();
    s.completedScenes.add(scene.id);
  }, [removeCursor, scrollToBottom]);

  const playBashResult = useCallback((scene) => {
    const s = stateRef.current;
    removeCursor();
    const container = document.createElement('div');
    container.style.marginTop = '4px';
    container.innerHTML = `<span class="tm-green">✓</span> <span class="tm-purple">$ ${escapeHtml(scene.command)}</span>\n`;
    outputRef.current.appendChild(container);
    let lineIdx = 0;
    const interval = setInterval(() => {
      if (lineIdx < scene.lines.length) {
        container.insertAdjacentHTML('beforeend', `<span class="tm-dim">    ${escapeHtml(scene.lines[lineIdx])}</span>\n`);
        lineIdx++;
        scrollToBottom();
      } else {
        clearInterval(interval);
        s.completedScenes.add(scene.id);
      }
    }, scene.speed * 12);
    s.intervals.push(interval);
  }, [removeCursor, scrollToBottom]);

  const startScene = useCallback((scene) => {
    switch (scene.type) {
      case 'welcome': playWelcome(scene); break;
      case 'instant': playInstant(scene); break;
      case 'input-box-bottom': playInputBoxBottom(scene); break;
      case 'typing': playTyping(scene); break;
      case 'spinner': playSpinner(scene); break;
      case 'thinking': playThinking(scene); break;
      case 'assistant-stream': playAssistant(scene); break;
      case 'tool-running': playToolRunning(scene); break;
      case 'diff': playDiff(scene); break;
      case 'bash-result': playBashResult(scene); break;
      default: break;
    }
  }, [playWelcome, playInstant, playInputBoxBottom, playTyping, playSpinner, playThinking, playAssistant, playToolRunning, playDiff, playBashResult]);

  useEffect(() => {
    const s = stateRef.current;
    let mounted = true;

    const start = () => {
      cleanup();
      s.startTime = performance.now();
      tick();
    };

    const tick = () => {
      if (!mounted) return;
      const elapsed = performance.now() - s.startTime;
      for (const scene of SCENES) {
        if (s.completedScenes.has(scene.id)) continue;
        if (elapsed >= scene.startTime && !s.activeScenes.has(scene.id)) {
          s.activeScenes.add(scene.id);
          startScene(scene);
        }
      }
      if (elapsed < 32000) {
        s.animationId = requestAnimationFrame(tick);
      } else {
        setTimeout(() => { if (mounted) start(); }, 3000);
      }
    };

    start();

    return () => {
      mounted = false;
      cleanup();
    };
  }, [cleanup, startScene]);

  return (
    <div data-testid="terminal-mock" className="tm-window">
      <div className="tm-title-bar">
        <div className="tm-traffic-lights">
          <span className="tm-tl-red" />
          <span className="tm-tl-yellow" />
          <span className="tm-tl-green" />
        </div>
        <span className="tm-title-text">deepseek — ~/csv-app</span>
      </div>
      <div className="tm-shell">
        <div className="tm-body">
          <div ref={outputRef} className="tm-output" style={{ fontSize: `${13 * (fontScale / 100)}px` }} />
        </div>
        <input
          aria-label="Terminal text size"
          aria-valuetext={`${fontScale}%`}
          className="tm-zoom"
          type="range"
          min="80"
          max="150"
          value={fontScale}
          onChange={(event) => setFontScale(Number(event.target.value))}
        />
      </div>
      <style>{`
        .tm-window { width: 100%; max-width: 900px; height: 600px; margin: 0 auto; border-radius: 10px; overflow: hidden; box-shadow: 0 20px 60px rgba(0,0,0,0.8); display: flex; flex-direction: column; font-family: 'JetBrains Mono', 'SF Mono', 'Fira Code', monospace; }
        .tm-title-bar { background: #1e1e2e; height: 32px; display: flex; align-items: center; padding: 0 12px; position: relative; flex-shrink: 0; }
        .tm-traffic-lights { display: flex; gap: 8px; }
        .tm-traffic-lights span { width: 12px; height: 12px; border-radius: 50%; }
        .tm-tl-red { background: #ff5f56; }
        .tm-tl-yellow { background: #ffbd2e; }
        .tm-tl-green { background: #27c93f; }
        .tm-title-text { position: absolute; left: 50%; transform: translateX(-50%); color: #888; font-size: 12px; }
        .tm-shell { background: #0d1117; flex: 1; min-height: 0; display: flex; align-items: stretch; }
        .tm-body { flex: 1; min-height: 0; padding: 16px 20px; overflow-y: auto; overflow-x: hidden; scroll-behavior: smooth; }
        .tm-body::-webkit-scrollbar { display: none; }
        .tm-body { -ms-overflow-style: none; scrollbar-width: none; }
        .tm-output { line-height: 1.5; color: #e0e0e0; white-space: pre-wrap; word-wrap: break-word; }
        .tm-zoom { width: 18px; margin: 10px 0; appearance: none; writing-mode: vertical-lr; direction: rtl; background: transparent; cursor: ns-resize; }
        .tm-zoom::-webkit-slider-runnable-track { width: 4px; background: linear-gradient(180deg, #2a2a3d 0%, #3d3d5c 100%); border-radius: 999px; }
        .tm-zoom::-webkit-slider-thumb { appearance: none; width: 14px; height: 14px; border-radius: 50%; background: #00cccc; border: 2px solid #0d1117; box-shadow: 0 0 0 1px rgba(0,204,204,0.25); margin-top: -5px; }
        .tm-zoom::-moz-range-track { width: 4px; background: linear-gradient(180deg, #2a2a3d 0%, #3d3d5c 100%); border-radius: 999px; }
        .tm-zoom::-moz-range-thumb { width: 14px; height: 14px; border-radius: 50%; background: #00cccc; border: 2px solid #0d1117; box-shadow: 0 0 0 1px rgba(0,204,204,0.25); }
        .tm-cursor { display: inline-block; width: 8px; height: 15px; background: #00cccc; animation: tm-blink 1s step-end infinite; vertical-align: text-bottom; margin-left: 1px; }
        @keyframes tm-blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
        .tm-cyan { color: #00cccc; }
        .tm-dim { color: #888888; }
        .tm-green { color: #44cc44; }
        .tm-bold { color: #ffffff; font-weight: bold; }
        .tm-purple { color: #cc66ff; }
        .tm-code { color: #c3e88d; }
        .tm-thinking-block { background: #111118; border-left: 2px solid #333; padding: 8px 12px; margin: 4px 0; border-radius: 4px; }
        .tm-thinking-label { color: #555; font-size: 11px; margin-bottom: 4px; }
        .tm-thinking-content { color: #8a8a8a; font-style: italic; }
        .tm-diff-line { background: rgba(34,92,43,0.3); color: #c3e88d; display: block; padding: 0 4px; margin: 0 -4px; }
        .tm-diff-header { color: #44cc44; }
        .tm-diff-info { color: #888888; }
      `}</style>
    </div>
  );
}
