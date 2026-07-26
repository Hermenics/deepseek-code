import React from "react";
import { motion } from "framer-motion";
import { Network, ShieldCheck, GitCommit, Layers, History } from "lucide-react";
import Chapter from "./Chapter";

/**
 * Chapter II — Multi-agent orchestration + architecture visual.
 * A stylized CSS-only module tree treated as an editorial diagram.
 */

const TREE = [
  {
    node: "OrchestratorSession",
    detail: "session · workspace · shared memory",
    accent: "neon-blue",
    children: [
      { node: "TaskRegistry", detail: "pending → running → done/failed" },
      { node: "Mailbox", detail: "async agent-to-agent" },
      { node: "Workspace", detail: "file-lease isolation" },
      { node: "EventSink", detail: "jsonl telemetry" },
      { node: "Snapshot", detail: "resumable state" },
      { node: "Review", detail: "auto output audit" },
    ],
  },
];

const HIGHLIGHTS = [
  {
    icon: Network,
    title: "Mixture of Agents",
    text: "Consult multiple models across providers and synthesize a consensus in a single tool call.",
    tag: "moa",
  },
  {
    icon: ShieldCheck,
    title: "Permissioned by risk",
    text: "Every tool call is scored: high · medium · low. Glob rules and pre/post hooks gate destructive ops.",
    tag: "permissions",
  },
  {
    icon: History,
    title: "File & git checkpoints",
    text: "Filesystem checkpoints + git worktrees keep multi-agent branches isolated and reversible.",
    tag: "checkpoints",
  },
  {
    icon: Layers,
    title: "Auto-compaction",
    text: "Context is summarized at threshold, latest turns preserved — sessions run for hours, not minutes.",
    tag: "context",
  },
];

export default function ChapterII() {
  return (
    <Chapter
      id="chapter-ii"
      numeral="II"
      kicker="the orchestra"
      title={
        <>
          Agents that
          <br />
          <span className="font-serif italic font-normal text-white/70">
            build alongside
          </span>{" "}
          agents.
        </>
      }
      lead="Fan out sub-agents into isolated workspaces with configurable concurrency, depth and cost ceilings. Compose them with MoA. Recover with checkpoints. Audit everything."
    >
      <div
        data-testid="architecture-tree"
        className="border border-white/10 bg-void p-6 md:p-10 font-mono text-sm"
      >
        <div className="flex items-center justify-between mb-8 text-[11px] uppercase tracking-widest text-white/40">
          <span>src/orchestration/</span>
          <span>module map</span>
        </div>

        {TREE.map((root) => (
          <div key={root.node}>
            <motion.div
              initial={{ opacity: 0, x: -10 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6 }}
              className="flex items-baseline gap-3 mb-6"
            >
              <GitCommit
                className="w-4 h-4 text-neon-blue self-center"
                strokeWidth={1.5}
              />
              <span className="text-white text-lg">{root.node}</span>
              <span className="text-white/40 text-xs">— {root.detail}</span>
            </motion.div>

            <div className="ml-2 md:ml-3 border-l border-white/15 pl-6 md:pl-8 space-y-4">
              {root.children.map((c, i) => (
                <motion.div
                  key={c.node}
                  initial={{ opacity: 0, x: -20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true, margin: "-40px" }}
                  transition={{ duration: 0.5, delay: i * 0.06 }}
                  className="relative"
                >
                  <div className="absolute -left-6 md:-left-8 top-[10px] w-5 md:w-7 h-[1px] bg-white/15" />
                  <div className="flex flex-wrap items-baseline gap-3">
                    <span className="text-[10px] uppercase tracking-widest text-white/30">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="text-white">{c.node}</span>
                    <span className="text-white/50 text-xs">— {c.detail}</span>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        ))}

        <div className="mt-10 pt-6 border-t border-white/10 grid md:grid-cols-2 gap-6 text-xs">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-white/40 mb-3">
              agents.settings.json
            </div>
            <pre className="text-white/80 leading-relaxed">
              <span className="text-white/40">{`{`}</span>
              {"\n  "}
              <span className="text-neon-cyan">{`"concurrency"`}</span>:{" "}
              <span className="text-neon-amber">6</span>,{"\n  "}
              <span className="text-neon-cyan">{`"maxDepth"`}</span>:{" "}
              <span className="text-neon-amber">3</span>,{"\n  "}
              <span className="text-neon-cyan">{`"maxFanOut"`}</span>:{" "}
              <span className="text-neon-amber">8</span>,{"\n  "}
              <span className="text-neon-cyan">{`"maxTokens"`}</span>:{" "}
              <span className="text-neon-amber">1_200_000</span>,{"\n  "}
              <span className="text-neon-cyan">{`"maxCostUsd"`}</span>:{" "}
              <span className="text-neon-amber">2.5</span>
              {"\n"}
              <span className="text-white/40">{`}`}</span>
            </pre>
          </div>
          <div className="border-l border-white/10 pl-6 hidden md:block">
            <div className="text-[10px] uppercase tracking-widest text-white/40 mb-3">
              runtime signals
            </div>
            <div className="space-y-2 text-white/70">
              <div className="flex justify-between"><span>active tasks</span><span className="text-neon-green">4 / 6</span></div>
              <div className="flex justify-between"><span>depth</span><span className="text-white">2</span></div>
              <div className="flex justify-between"><span>reviewer</span><span className="text-neon-blue">deepseek-v4-flash</span></div>
              <div className="flex justify-between"><span>cost</span><span className="text-neon-amber">$0.94 / $2.50</span></div>
            </div>
          </div>
        </div>
      </div>

      <div
        data-testid="chapter-ii-highlights"
        className="mt-12 grid md:grid-cols-2 gap-[1px] bg-white/10 border border-white/10"
      >
        {HIGHLIGHTS.map((h, i) => {
          const Icon = h.icon;
          return (
            <motion.div
              key={h.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{ duration: 0.6, delay: i * 0.08 }}
              className="bg-void hover:bg-elevated transition-colors p-8 md:p-10 flex flex-col gap-4"
            >
              <div className="flex items-center justify-between">
                <Icon className="w-7 h-7 text-white" strokeWidth={1.4} />
                <span className="text-[10px] uppercase tracking-widest font-mono text-white/40">
                  {h.tag}
                </span>
              </div>
              <h3 className="font-sans font-bold text-white text-2xl md:text-3xl tracking-tight leading-tight">
                {h.title}
              </h3>
              <p className="font-mono text-sm text-white/60 leading-relaxed max-w-md">
                {h.text}
              </p>
            </motion.div>
          );
        })}
      </div>
    </Chapter>
  );
}
