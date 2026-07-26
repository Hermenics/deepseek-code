import React from "react";
import { motion } from "framer-motion";
import {
  FileText, FileEdit, FileDiff, FolderOpen, Terminal as TerminalIcon,
  Search, Regex, GitBranch, Globe, Users, MessageCircleQuestion,
  Brain, ListChecks, Compass, BookOpen, Sparkles, ClipboardCheck,
  PencilRuler, FileCode,
} from "lucide-react";
import Chapter from "./Chapter";

const TOOLS = [
  { name: "write_file", icon: FileText, note: "create · overwrite" },
  { name: "edit_file", icon: FileEdit, note: "search & replace" },
  { name: "patch_file", icon: FileDiff, note: "unified diff apply" },
  { name: "read_file", icon: FileCode, note: "load context" },
  { name: "read_folder", icon: FolderOpen, note: "directory listing" },
  { name: "shell", icon: TerminalIcon, note: "sandboxed exec" },
  { name: "grep", icon: Regex, note: "regex over tree" },
  { name: "glob", icon: Search, note: "filename patterns" },
  { name: "git", icon: GitBranch, note: "status · diff · commit" },
  { name: "web_fetch", icon: Globe, note: "http get / post" },
  { name: "subagent", icon: Users, note: "spawn isolated task" },
  { name: "ask_agent", icon: MessageCircleQuestion, note: "consult · no tools" },
  { name: "memory", icon: Brain, note: "persistent knowledge" },
  { name: "todo", icon: ListChecks, note: "task ledger" },
  { name: "introspect", icon: Compass, note: "self-reflection" },
  { name: "update_knowledge", icon: BookOpen, note: "codify learnings" },
  { name: "moa", icon: Sparkles, note: "mixture of agents" },
  { name: "submit_plan", icon: ClipboardCheck, note: "plan for review" },
  { name: "write_plan", icon: PencilRuler, note: "author plan file" },
];

const PARALLEL = new Set([
  "subagent", "ask_agent", "grep", "glob",
  "read_file", "read_folder", "web_fetch", "introspect",
]);

export default function ChapterI() {
  return (
    <Chapter
      id="chapter-i"
      numeral="I"
      kicker="the toolset"
      title={
        <>
          Nineteen tools.
          <br />
          <span className="text-white/50">Zero friction.</span>
        </>
      }
      lead="Every tool is a surgical instrument: read-only ones fan out in parallel, mutations run under permissioned checkpoints, and every call is auditable in the TUI as it happens."
    >
      <div
        data-testid="tools-grid"
        className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-[1px] bg-white/10 border border-white/10"
      >
        {TOOLS.map((t, i) => {
          const Icon = t.icon;
          const parallel = PARALLEL.has(t.name);
          return (
            <motion.div
              key={t.name}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{
                duration: 0.55,
                delay: (i % 4) * 0.05,
                ease: [0.76, 0, 0.24, 1],
              }}
              className="group relative bg-void hover:bg-elevated transition-colors p-6 md:p-7 min-h-[160px] flex flex-col justify-between"
            >
              <div className="flex items-start justify-between">
                <Icon
                  className="w-6 h-6 text-white/80 group-hover:text-neon-blue transition-colors"
                  strokeWidth={1.4}
                />
                <span className="text-[10px] tracking-widest font-mono text-white/30">
                  {String(i + 1).padStart(2, "0")}
                </span>
              </div>
              <div>
                <div className="font-mono text-white text-sm mb-1">
                  {t.name}
                  <span className="text-white/40">()</span>
                </div>
                <div className="text-[11px] uppercase tracking-widest font-mono text-white/40 mb-2">
                  {t.note}
                </div>
                {parallel && (
                  <div className="inline-flex items-center gap-1 text-[9px] uppercase tracking-widest font-mono text-neon-green border border-neon-green/30 px-1.5 py-0.5">
                    ∥ parallel
                  </div>
                )}
              </div>
              <div className="absolute inset-x-0 bottom-0 h-[2px] bg-neon-blue scale-x-0 group-hover:scale-x-100 origin-left transition-transform duration-500" />
            </motion.div>
          );
        })}
      </div>

      <div className="mt-16 grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6">
        {[
          { k: "19", v: "core tools" },
          { k: "34", v: "slash commands" },
          { k: "8", v: "run in parallel" },
          { k: "42k+", v: "lines of source" },
        ].map((s) => (
          <div
            key={s.v}
            className="border border-white/10 p-6 md:p-7 bg-void hover:bg-elevated transition-colors"
          >
            <div className="font-serif italic text-white text-5xl md:text-6xl leading-none">
              {s.k}
            </div>
            <div className="mt-3 text-[10px] uppercase tracking-widest font-mono text-white/50">
              {s.v}
            </div>
          </div>
        ))}
      </div>
    </Chapter>
  );
}
