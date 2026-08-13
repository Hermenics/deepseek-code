import { useEffect, useState, useRef, useCallback } from "react";
import { Link, useLocation } from "react-router-dom";

/* ---------- Icons (inline SVG, no deps) ---------- */
export const Icon = {
  Sun: (p) => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  ),
  Moon: (p) => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  ),
  GitHub: (p) => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" {...p}>
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56v-2.04c-3.2.7-3.88-1.36-3.88-1.36-.52-1.33-1.28-1.69-1.28-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.71 1.26 3.37.97.1-.75.4-1.26.73-1.55-2.55-.29-5.23-1.27-5.23-5.66 0-1.25.45-2.28 1.18-3.08-.12-.29-.51-1.46.11-3.05 0 0 .97-.31 3.18 1.18.92-.26 1.91-.39 2.9-.39s1.98.13 2.9.39c2.21-1.49 3.18-1.18 3.18-1.18.62 1.59.23 2.76.11 3.05.74.8 1.18 1.83 1.18 3.08 0 4.4-2.69 5.37-5.25 5.65.41.35.78 1.05.78 2.12v3.14c0 .31.21.68.8.56C20.21 21.38 23.5 17.07 23.5 12 23.5 5.65 18.35.5 12 .5z" />
    </svg>
  ),
  Menu: (p) => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M3 6h18M3 12h18M3 18h18" />
    </svg>
  ),
  Info: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" />
    </svg>
  ),
  Arrow: () => <span className="arr">→</span>,
  Chevron: (p) => (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="m9 18 6-6-6-6" />
    </svg>
  ),
};

/* ---------- Sidebar data ---------- */
const NAV = [
  {
    title: "Get Started",
    items: [
      { label: "Overview", href: "/docs" },
      { label: "Quickstart", href: "/docs/quickstart" },
      { label: "Installation", href: "/docs/installation" },
      { label: "Update & uninstall", href: "/docs/upgrade" },
      { label: "Repository onboarding", href: "/docs/repository-onboarding" },
      { label: "Working directory", href: "/docs/working-directory" },
      { label: "Common workflows", href: "/docs/common-workflows" },
      { label: "Best practices", href: "/docs/best-practices" },
      { label: "Prompting", href: "/docs/prompting" },
      { label: "Prompt library", href: "/docs/prompt-library" },
    ],
  },
  {
    title: "Concepts",
    items: [
      { label: "How it works", href: "/docs/how-it-works" },
      { label: "Architecture", href: "/docs/architecture" },
      { label: "The .deepseek directory", href: "/docs/deepseek-directory" },
      { label: "Context window", href: "/docs/context-window" },
      { label: "Steering", href: "/docs/steering" },
      { label: "Memory", href: "/docs/memory" },
      { label: "Sessions & context", href: "/docs/sessions-context" },
      { label: "Session lifecycle", href: "/docs/session-lifecycle" },
      { label: "Goals", href: "/docs/goals" },
      { label: "Todo lists", href: "/docs/todos" },
      { label: "Kernel & persistence", href: "/docs/kernel-persistence" },
    ],
  },
  {
    title: "Guides",
    items: [
      { label: "Compaction", href: "/docs/compaction" },
      { label: "Plan mode", href: "/docs/plan-mode" },
      { label: "Prompt refiner", href: "/docs/prompt-refiner" },
      { label: "Prompt queue", href: "/docs/prompt-queue" },
      { label: "Side questions", href: "/docs/side-questions" },
      { label: "Retry & clear", href: "/docs/retry-and-clear" },
      { label: "Checkpointing & undo", href: "/docs/checkpointing" },
      { label: "Git integration", href: "/docs/git-integration" },
      { label: "Diff review", href: "/docs/diff-review" },
      { label: "Worktrees", href: "/docs/worktrees" },
      { label: "Large codebases", href: "/docs/large-codebases" },
      { label: "Session export", href: "/docs/session-export" },
      { label: "Verification", href: "/docs/verification" },
      { label: "Headless mode", href: "/docs/headless" },
      { label: "Pipe mode", href: "/docs/pipe-mode" },
      { label: "JSON output", href: "/docs/json-output" },
      { label: "Streaming behavior", href: "/docs/streaming-behavior" },
      { label: "Monitoring & audit", href: "/docs/monitoring-audit" },
      { label: "Workflows", href: "/docs/workflows" },
      { label: "Automation", href: "/docs/automation" },
    ],
  },
  {
    title: "Agents & orchestration",
    items: [
      { label: "Agents", href: "/docs/agents" },
      { label: "Agent library", href: "/docs/agent-library" },
      { label: "Sub-agents", href: "/docs/subagents" },
      { label: "Agent teams", href: "/docs/agent-teams" },
      { label: "Parallel tasks", href: "/docs/parallel-tasks" },
      { label: "Agent messaging", href: "/docs/agent-messaging" },
      { label: "Task control", href: "/docs/task-control" },
      { label: "Multi-agent review", href: "/docs/code-review" },
      { label: "Mixture of Agents", href: "/docs/moa" },
    ],
  },
  {
    title: "Extending",
    items: [
      { label: "Plugins & skills", href: "/docs/plugins-skills" },
      { label: "Plugin authoring", href: "/docs/plugin-authoring" },
      { label: "Skill authoring", href: "/docs/skill-authoring" },
      { label: "Integration catalog", href: "/docs/catalog" },
      { label: "Hooks", href: "/docs/hooks" },
      { label: "Hook lifecycle", href: "/docs/hook-lifecycle" },
      { label: "Hook input & output", href: "/docs/hook-input-output" },
      { label: "Hook troubleshooting", href: "/docs/hook-troubleshooting" },
    ],
  },
  {
    title: "Interface",
    items: [
      { label: "Interface (TUI)", href: "/docs/interface" },
      { label: "Terminal setup", href: "/docs/terminal-setup" },
      { label: "Input editor", href: "/docs/input-editor" },
      { label: "External editor", href: "/docs/external-editor" },
      { label: "Vim mode", href: "/docs/vim-mode" },
      { label: "Clipboard & pasting", href: "/docs/clipboard-pasting" },
      { label: "Command palette", href: "/docs/command-palette" },
      { label: "File references", href: "/docs/file-references" },
      { label: "Keyboard shortcuts", href: "/docs/keybindings" },
      { label: "Status bar", href: "/docs/status-bar" },
      { label: "Activity panel", href: "/docs/activity-panel" },
      { label: "Reasoning display", href: "/docs/reasoning-display" },
      { label: "Terminal rendering", href: "/docs/terminal-rendering" },
      { label: "Themes", href: "/docs/themes" },
      { label: "Interaction modes", href: "/docs/interaction-modes" },
      { label: "Accessibility", href: "/docs/accessibility" },
      { label: "Mobile app links", href: "/docs/mobile" },
    ],
  },
  {
    title: "Tools",
    items: [
      { label: "Tool overview", href: "/docs/tools" },
      { label: "Tool results & truncation", href: "/docs/tool-results" },
      { label: "File operations", href: "/docs/file-operations" },
      { label: "Search tools", href: "/docs/search" },
      { label: "Shell commands", href: "/docs/shell" },
      { label: "Web fetch", href: "/docs/web-fetch" },
      { label: "Update project knowledge", href: "/docs/update-knowledge" },
      { label: "LSP navigation", href: "/docs/lsp" },
      { label: "MCP", href: "/docs/mcp" },
      { label: "MCP configuration", href: "/docs/mcp-configuration" },
      { label: "MCP transports", href: "/docs/mcp-transports" },
    ],
  },
  {
    title: "Providers",
    items: [
      { label: "Provider overview", href: "/docs/providers" },
      { label: "Authentication", href: "/docs/authentication" },
      { label: "DeepSeek API", href: "/docs/deepseek-api" },
      { label: "Amazon Bedrock", href: "/docs/amazon-bedrock" },
      { label: "Google Vertex AI", href: "/docs/google-vertex-ai" },
      { label: "Local models", href: "/docs/local-models" },
      { label: "Model configuration", href: "/docs/model-config" },
      { label: "Model & effort", href: "/docs/model-and-effort" },
    ],
  },
  {
    title: "Configuration",
    items: [
      { label: "Settings", href: "/docs/settings" },
      { label: "Settings center", href: "/docs/settings-center" },
      { label: "Permissions", href: "/docs/permissions" },
      { label: "Permission patterns", href: "/docs/permission-patterns" },
      { label: "External paths", href: "/docs/external-paths" },
      { label: "Feature flags", href: "/docs/features" },
      { label: "Debug your config", href: "/docs/debug-config" },
    ],
  },
  {
    title: "Development",
    items: [
      { label: "Development setup", href: "/docs/development" },
      { label: "Contributing", href: "/docs/contributing" },
      { label: "Testing", href: "/docs/testing" },
      { label: "Build & publishing", href: "/docs/build-publishing" },
    ],
  },
  {
    title: "Reference",
    items: [
      { label: "CLI reference", href: "/docs/cli-reference" },
      { label: "Commands", href: "/docs/commands" },
      { label: "Slash commands", href: "/docs/slash-commands" },
      { label: "Environment variables", href: "/docs/env-vars" },
      { label: "Doctor", href: "/docs/doctor" },
      { label: "System inspection", href: "/docs/system-inspection" },
      { label: "Error reference", href: "/docs/errors" },
      { label: "Glossary", href: "/docs/glossary" },
      { label: "Costs & usage", href: "/docs/costs" },
      { label: "Cost accounting", href: "/docs/cost-accounting" },
      { label: "Exit codes", href: "/docs/exit-codes" },
      { label: "Security", href: "/docs/security" },
      { label: "Troubleshooting", href: "/docs/troubleshooting" },
      { label: "Changelog", href: "/docs/changelog" },
    ],
  },
];

/* ---------- Shared bits ---------- */
export function CodeBlock({ lang, children }) {
  const copy = useCallback((text) => {
    if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {});
  }, []);
  return (
    <div className="codeblock">
      <div className="codeblock-head">
        <span className="lang">{lang}</span>
        <button className="copy" onClick={() => copy(typeof children === "string" ? children : "")}>Copy</button>
      </div>
      <pre>{children}</pre>
    </div>
  );
}

export function Note({ children }) {
  return (
    <div className="note">
      <Icon.Info className="note-icon" width="18" height="18" />
      <div>{children}</div>
    </div>
  );
}

/* ---------- Table of contents (scrollspy) ---------- */
export function Toc({ items }) {
  const [active, setActive] = useState(items[0]?.id);
  useEffect(() => {
    const els = items.map((t) => document.getElementById(t.id)).filter(Boolean);
    if (!els.length) return;
    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-80px 0px -70% 0px", threshold: [0, 1] }
    );
    els.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, [items]);
  return (
    <aside className="toc" aria-label="On this page">
      <div className="toc-title">On this page</div>
      <ul>
        {items.map((t) => (
          <li key={t.id}>
            <a href={`#${t.id}`} className={active === t.id ? "active" : ""}>{t.label}</a>
          </li>
        ))}
      </ul>
    </aside>
  );
}

/* ---------- Layout (topbar + sidebar + shell) ---------- */
export default function Layout({ children }) {
  const [theme, setTheme] = useState(() => {
    if (typeof window === "undefined") return "light";
    return localStorage.getItem("dsc-theme") || "light";
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  const rootRef = useRef(null);
  const location = useLocation();

  useEffect(() => {
    if (rootRef.current) rootRef.current.dataset.theme = theme;
    localStorage.setItem("dsc-theme", theme);
  }, [theme]);

  const isActive = (href) => {
    if (href === "/docs") return location.pathname === "/docs";
    return location.pathname === href || location.pathname.startsWith(`${href}/`);
  };

  return (
    <div className="dsc-docs" ref={rootRef}>
      <header className="topbar">
        <div className="topbar-inner">
          <Link to="/docs" className="brand">
            <span className="brand-mark">
              <img src={`${process.env.PUBLIC_URL}/dsc-logo.png`} alt="DeepSeek Code logo" />
            </span>
            <span className="brand-name">
              DeepSeek Code<span className="slash">/</span><span className="docs">Docs</span>
            </span>
          </Link>

          <div className="top-actions">
            <button
              className="mobile-toggle"
              onClick={() => setMobileOpen((v) => !v)}
              aria-label="Toggle navigation"
              aria-expanded={mobileOpen}
              aria-controls="docs-sidebar"
            >
              <Icon.Menu />
            </button>
            <a className="icon-btn label" href="https://github.com/Hermenics/deepseek-code" title="GitHub">
              <Icon.GitHub /> <span>GitHub</span>
            </a>
            <button
              className="icon-btn"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              aria-label="Toggle theme"
              title="Toggle theme"
            >
              {theme === "dark" ? <Icon.Sun /> : <Icon.Moon />}
            </button>
            <Link className="icon-btn primary" to="/docs/quickstart">Get started</Link>
          </div>
        </div>
      </header>

      <div className="shell">
        <aside id="docs-sidebar" className={`sidebar ${mobileOpen ? "mobile-open" : ""}`}>
          {NAV.map((g) => (
            <div className="nav-group" key={g.title}>
              <div className="nav-group-title">{g.title}</div>
              <ul className="nav-list">
                {g.items.map((it) => (
                  <li key={it.label} className={`nav-item ${isActive(it.href) ? "active" : ""}`}>
                    <Link to={it.href} onClick={() => setMobileOpen(false)}>{it.label}</Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </aside>

        {children}
      </div>
    </div>
  );
}
