import React, { useEffect, useRef, useState } from "react";

const PROMPT = "Build a full-stack CSV analyzer using sample.csv as a reference. Create main.py and index.html, then verify the Python file.";
const SPINNER = ["◌", "○", "◎", "◉", "◎", "○"];

const TOOLS = [
  { name: "List", args: ".", phase: "Inspecting project files...", kind: "list", duration: 1700 },
  { name: "Read", args: "sample.csv", phase: "Reading the CSV sample...", kind: "read", duration: 1700 },
  { name: "Write", args: "main.py", phase: "Creating the FastAPI backend...", kind: "main", duration: 2100 },
  { name: "Write", args: "index.html", phase: "Creating the upload page...", kind: "html", duration: 1800 },
  { name: "Bash", args: "python3 -m py_compile main.py", phase: "Checking Python syntax...", kind: "bash", duration: 1800 },
];

const DIFFS = {
  main: {
    path: "~/csv-app/main.py",
    added: 16,
    lines: [
      "from fastapi import FastAPI, UploadFile, File",
      "from fastapi.responses import HTMLResponse",
      "import io",
      "import pandas as pd",
      "",
      "app = FastAPI()",
      "",
      '@app.get("/", response_class=HTMLResponse)',
      "async def home():",
      '    return open("index.html", encoding="utf-8").read()',
      "",
      '@app.post("/upload")',
      "async def upload(file: UploadFile = File(...)):",
      "    frame = pd.read_csv(io.BytesIO(await file.read()))",
      "    averages = frame.mean(numeric_only=True).round(2).to_dict()",
      '    return {"rows": len(frame), "averages": averages}',
    ],
  },
  html: {
    path: "~/csv-app/index.html",
    added: 6,
    lines: [
      "<!doctype html>",
      '<html lang="en"><meta charset="utf-8"><title>CSV Analyzer</title>',
      '<h1>CSV Analyzer</h1><input id="file" type="file" accept=".csv"><pre id="result">Choose a CSV file</pre>',
      "<script>",
      'file.onchange = async () => { const body = new FormData(); body.append("file", file.files[0]); const response = await fetch("/upload", { method: "POST", body }); result.textContent = JSON.stringify(await response.json(), null, 2); };',
      "</script></html>",
    ],
  },
};

function Diff({ diff }) {
  return (
    <div className="tm-diff">
      <div className="tm-diff-path"><span>▸</span> Write <code>{diff.path}</code></div>
      <div className="tm-diff-stats"><span>+{diff.added}</span><i> / </i><span>-0</span><i> at L1 in {diff.path.split("/").at(-1)}</i></div>
      <div className="tm-diff-lines">
        {diff.lines.map((line, index) => (
          <div className="tm-diff-line" key={`${index}-${line}`}>
            <span className="tm-line-gutter">{String(index + 1).padStart(2, " ")} + </span>
            <code>{line || " "}</code>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function TerminalMock() {
  const bodyRef = useRef(null);
  const startTime = useRef(0);
  const cancelledRef = useRef(false);
  const spinnerRef = useRef(null);
  const [typed, setTyped] = useState(0);
  const [submitted, setSubmitted] = useState(false);
  const [activeTool, setActiveTool] = useState(-1);
  const [completedTools, setCompletedTools] = useState(0);
  const [thinkingFinal, setThinkingFinal] = useState(false);
  const [finished, setFinished] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [spinnerTick, setSpinnerTick] = useState(0);

  useEffect(() => {
    cancelledRef.current = false;
    const timers = [];
    const wait = (ms) => new Promise((resolve) => {
      timers.push(setTimeout(resolve, ms));
    });
    const run = async () => {
      startTime.current = Date.now();
      for (let index = 1; index <= PROMPT.length; index += 1) {
        if (cancelledRef.current) return;
        setTyped(index);
        await wait(14);
      }
      if (cancelledRef.current) return;
      setSubmitted(true);
      await wait(1400);
      for (let index = 0; index < TOOLS.length; index += 1) {
        if (cancelledRef.current) return;
        setActiveTool(index);
        await wait(TOOLS[index].duration);
        if (cancelledRef.current) return;
        setCompletedTools(index + 1);
        setActiveTool(-1);
        await wait(450);
      }
      if (cancelledRef.current) return;
      setThinkingFinal(true);
      await wait(750);
      if (cancelledRef.current) return;
      setElapsed(Math.max(1, Math.round((Date.now() - startTime.current) / 1000)));
      setFinished(true);
    };
    run();
    spinnerRef.current = setInterval(() => setSpinnerTick((tick) => tick + 1), 150);
    return () => {
      cancelledRef.current = true;
      clearInterval(spinnerRef.current);
      timers.forEach(clearTimeout);
    };
  }, []);

  useEffect(() => {
    const body = bodyRef.current;
    if (body) body.scrollTop = body.scrollHeight;
  }, [typed, submitted, activeTool, completedTools, thinkingFinal, finished]);

  useEffect(() => {
    if (activeTool < 0 || finished) return undefined;
    setElapsed(0);
    const timer = setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [activeTool, finished]);

  const active = TOOLS[activeTool];
  const shownWrites = Math.min(2, Math.max(0, completedTools - 2));

  return (
    <div data-testid="terminal-mock" className="tm-window">
      <header className="tm-header">
        <pre className="tm-ascii"><span>  ▄▄███▄▄</span>{"\n"}<span> ▄█ ◉    ██▄</span>{"\n"}<span>█          ~~█</span>{"\n"}<span> ▀▄▄█▄▄▄▄█▀</span></pre>
        <div className="tm-header-copy">
          <div><b>◈ DeepSeek Code</b><span>v0.7.8 · deepseek</span></div>
          <p>cwd: <code>~/csv-app</code></p>
          <p>/help for commands &nbsp;·&nbsp; /quit to exit</p>
        </div>
      </header>

      <div className="tm-body" ref={bodyRef}>
        <div className="tm-output">
          {submitted && <div className="tm-user"><span>▌</span>{PROMPT}</div>}
          {submitted && completedTools === 0 && activeTool < 0 && !finished && <div className="tm-running"><span className="tm-spinner">{SPINNER[spinnerTick % SPINNER.length]}</span>Planning the implementation... <i>· Ctrl+C to cancel</i></div>}

          {!finished && Array.from({ length: completedTools }, (_, index) => {
            const tool = TOOLS[index];
            const diff = tool.kind === "main" ? DIFFS.main : tool.kind === "html" ? DIFFS.html : null;
            return (
              <React.Fragment key={tool.kind}>
                {!diff && <div className="tm-tool-row">
                  <div><span className="tm-tool-icon">▸</span><b className={`tm-tool-${tool.name.toLowerCase()}`}>{tool.name}</b><span>{tool.args}</span></div>
                  <span className="tm-success">✓</span>
                </div>}
                {tool.kind === "list" && <div className="tm-tool-result"><span>▸</span> README.md · sample.csv</div>}
                {tool.kind === "read" && <div className="tm-tool-result"><span>▸</span> Read ~/csv-app/sample.csv · 5 lines total <b>✓</b></div>}
                {diff && <Diff diff={diff} />}
                {tool.kind === "bash" && <div className="tm-tool-result tm-bash-result"><span>✓</span> (no output)</div>}
              </React.Fragment>
            );
          })}

          {active && !finished && <>
            <div className="tm-running"><span className="tm-spinner">{SPINNER[spinnerTick % SPINNER.length]}</span>{active.phase} <i>· Ctrl+C to cancel</i></div>
            <div className="tm-tool-row tm-tool-active">
              <div><span className="tm-tool-icon">▸</span><b className={`tm-tool-${active.name.toLowerCase()}`}>{active.name}</b><span>{active.args}</span></div>
              <span className="tm-tool-timing">{elapsed > 0 ? `${elapsed}s ` : ""}<span className="tm-spinner">{SPINNER[spinnerTick % SPINNER.length]}</span></span>
            </div>
          </>}

          {thinkingFinal && !finished && <div className="tm-running"><span className="tm-spinner">{SPINNER[spinnerTick % SPINNER.length]}</span>Preparing the summary... <i>· Ctrl+C to cancel</i></div>}

          {finished && <>
            <div className="tm-work-truncated">Work truncated (ctrl+o to expand)</div>
            <div className="tm-assistant"><span>◆</span> Done. I built a FastAPI CSV analyzer with a small upload page, then ran <code>python3 -m py_compile main.py</code> successfully.</div>
            <div className="tm-wave">&nbsp;&nbsp;∿∿ {elapsed}s · {TOOLS.length} tools {"∿".repeat(48)}</div>
          </>}

          {shownWrites > 0 && <div className="tm-changed-files">
            <div>Changed files <span>· Ctrl+D opens the latest diff</span></div>
            {shownWrites >= 1 && <p><b>+16</b> -0 <code>~/csv-app/main.py</code></p>}
            {shownWrites >= 2 && <p><b>+6</b> -0 <code>~/csv-app/index.html</code></p>}
          </div>}
        </div>
      </div>

      <footer className="tm-footer">
        <div className="tm-input">
          <span className="tm-agent-label">deepseek</span>
          <span className="tm-prompt-mark">›</span>
          <span className="tm-input-text">{submitted ? <span className="tm-muted">What do you want me to do? ↵</span> : PROMPT.slice(0, typed)}{!submitted && <span className="tm-cursor" />}</span>
        </div>
        <div className="tm-status"><span>Build</span><i>◈ deepseek-flash</i></div>
      </footer>

      <style>{`
        .tm-window { width: 100%; height: clamp(460px, 70vh, 760px); min-height: 0; display: flex; flex-direction: column; overflow: hidden; background: #0d1117; color: #f3f6fb; font: 12px/1.55 'JetBrains Mono', 'SF Mono', 'Fira Code', monospace; }
        .tm-header { flex: 0 0 auto; display: flex; align-items: center; gap: 18px; padding: 16px 22px; background: #0d1117; }
        .tm-ascii { margin: 0; color: #78a9ff; font: inherit; line-height: 1.25; }
        .tm-ascii span:nth-child(even) { color: #a7c7ff; }
        .tm-header-copy { min-width: 0; color: #93a1b5; }
        .tm-header-copy > div { display: flex; flex-wrap: wrap; gap: 7px; align-items: baseline; }
        .tm-header-copy b { color: #78a9ff; font-weight: 500; }
        .tm-header-copy p { margin: 2px 0 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .tm-header-copy code { color: #7dd3fc; }
        .tm-body { flex: 1 1 auto; min-height: 0; padding: 16px 22px; overflow: auto; overscroll-behavior: contain; scroll-behavior: smooth; scrollbar-width: thin; scrollbar-color: #456a9f transparent; }
        .tm-body::-webkit-scrollbar { width: 8px; }
        .tm-body::-webkit-scrollbar-thumb { border: 2px solid #0d1117; border-radius: 8px; background: #456a9f; }
        .tm-output { max-width: 1180px; margin: 0 auto; color: #f3f6fb; white-space: pre-wrap; overflow-wrap: anywhere; }
        .tm-user { display: flex; gap: 8px; margin: 1px 0 16px; color: #f3f6fb; }
        .tm-user > span { flex: 0 0 auto; color: #78a9ff; }
        .tm-running { display: flex; align-items: baseline; gap: 8px; min-height: 24px; color: #93a1b5; }
        .tm-running i { color: #718096; font-style: normal; }
        .tm-spinner { color: #78a9ff; }
        .tm-tool-row { display: flex; justify-content: space-between; gap: 12px; padding: 2px 8px 2px 20px; color: #718096; }
        .tm-tool-row > div { display: flex; gap: 8px; min-width: 0; overflow-wrap: anywhere; }
        .tm-tool-row b { font-weight: 400; }
        .tm-tool-icon { flex: 0 0 auto; color: #78a9ff; }
        .tm-tool-read, .tm-tool-list { color: #5599ff; }
        .tm-tool-write, .tm-tool-edit { color: #44cc44; }
        .tm-tool-bash { color: #cc66ff; }
        .tm-success { flex: 0 0 auto; color: #7bd88f; }
        .tm-tool-timing { flex: 0 0 auto; color: #93a1b5; }
        .tm-tool-result { display: flex; gap: 8px; padding-left: 42px; color: #93a1b5; }
        .tm-tool-result > span { color: #78a9ff; }
        .tm-tool-result b { margin-left: auto; color: #7bd88f; font-weight: 400; }
        .tm-diff { margin: 9px 0 12px; }
        .tm-diff-path { display: flex; gap: 8px; padding-left: 20px; color: #93a1b5; }
        .tm-diff-path > span { color: #78a9ff; }
        .tm-diff-path code { color: #7dd3fc; font: inherit; }
        .tm-diff-stats { padding-left: 42px; color: #718096; }
        .tm-diff-stats span { color: #38a660; }
        .tm-diff-stats i { color: #718096; font-style: normal; }
        .tm-diff-lines { margin-top: 7px; }
        .tm-diff-line { display: flex; min-width: 0; padding: 0 4px 0 8px; background: rgb(34 92 43 / 42%); color: #bedfcc; }
        .tm-line-gutter { flex: 0 0 auto; color: #a2b8a7; white-space: pre; }
        .tm-diff-line code { min-width: 0; overflow: hidden; color: #bedfcc; font: inherit; text-overflow: ellipsis; white-space: pre; }
        .tm-bash-result { color: #93a1b5; }
        .tm-work-truncated { display: flex; align-items: center; gap: 10px; margin: 16px 0 8px; color: #718096; white-space: nowrap; }
        .tm-work-truncated::before, .tm-work-truncated::after { height: 1px; flex: 1; background: #33445f; content: ''; }
        .tm-assistant { margin-top: 8px; }
        .tm-assistant > span { margin-right: 7px; color: #78a9ff; }
        .tm-assistant code { color: #c3e88d; font: inherit; }
        .tm-wave { margin-top: 10px; color: #718096; white-space: nowrap; overflow: hidden; }
        .tm-changed-files { margin-top: 14px; padding-left: 8px; color: #93a1b5; }
        .tm-changed-files > div { color: #f3f6fb; }
        .tm-changed-files > div span { color: #718096; }
        .tm-changed-files p { margin: 3px 0 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .tm-changed-files b { color: #38a660; font-weight: 400; }
        .tm-changed-files code { margin-left: 5px; color: #93a1b5; font: inherit; }
        .tm-footer { flex: 0 0 auto; padding: 4px 20px 10px; background: #0d1117; }
        .tm-input { position: relative; display: flex; align-items: flex-start; gap: 9px; min-height: 56px; padding: 14px 12px 10px; border: 1px solid #456a9f; border-radius: 9px; color: #f3f6fb; }
        .tm-agent-label { position: absolute; top: -9px; right: 14px; padding: 0 6px; background: #0d1117; color: #a7c7ff; }
        .tm-prompt-mark { color: #78a9ff; }
        .tm-input-text { min-width: 0; max-height: 52px; overflow: hidden; overflow-wrap: anywhere; }
        .tm-muted { color: #718096; }
        .tm-cursor { display: inline-block; width: 7px; height: 14px; margin-left: 2px; background: #9dc2ff; vertical-align: -2px; animation: tm-blink 1s step-end infinite; }
        @keyframes tm-blink { 50% { opacity: 0; } }
        .tm-status { display: flex; gap: 10px; padding: 7px 4px 0; color: #7bd88f; }
        .tm-status i { color: #78a9ff; font-style: normal; }
        @media (max-width: 640px) {
          .tm-window { height: clamp(440px, 68vh, 640px); }
          .tm-header { gap: 0; padding: 12px 14px; }
          .tm-body { padding: 12px 14px; }
          .tm-footer { padding: 4px 12px 8px; }
          .tm-input { min-height: 52px; padding: 12px 9px 8px; }
          .tm-output { font-size: 11px; }
          .tm-tool-row { padding-left: 8px; }
          .tm-diff-path { padding-left: 8px; }
          .tm-diff-stats { padding-left: 28px; }
          .tm-tool-result { padding-left: 28px; }
        }
        @media (max-width: 480px) { .tm-ascii { display: none; } }
      `}</style>
    </div>
  );
}
