import React from "react";

const COMMANDS = [
  "/help", "/model", "/clear", "/compact", "/plan", "/review", "/config",
  "/agent", "/agents", "/vim", "/quit", "/checkpoint", "/sessions", "/undo",
  "/retry", "/cost", "/files", "/tools", "/system", "/permissions", "/btw",
  "/stats", "/memory", "/effort", "/skill", "/plugin", "/context", "/tasks",
  "/task", "/cwd", "/worktree", "/mobile", "/logout",
];

export default function Marquee() {
  return (
    <section data-testid="commands-marquee" className="relative py-32 md:py-40 border-t border-white/10 overflow-hidden">
      <div className="max-w-[1440px] mx-auto px-6 md:px-10 mb-16 md:mb-20 grid md:grid-cols-12 gap-8">
        <div className="md:col-span-4">
          <div className="text-[11px] uppercase tracking-widest font-mono text-neon-blue mb-4">— interlude</div>
          <div className="font-serif italic text-white/80 text-4xl md:text-5xl leading-tight">Thirty-four<br /><span className="text-white">verbs.</span></div>
        </div>
        <div className="md:col-span-6 md:col-start-7">
          <p className="font-mono text-sm text-white/60 leading-relaxed max-w-lg">A slash-command vocabulary as expressive as the shell it lives in — swap models, restore checkpoints, review plans, mint worktrees, beam a QR to your phone.</p>
        </div>
      </div>

      <div className="relative">
        <div className="marquee-track flex w-max whitespace-nowrap will-change-transform">
          {[0, 1].map((copy) => (
            <div key={copy} aria-hidden={copy === 1} className="marquee-group flex shrink-0 gap-16 pr-16">
              {COMMANDS.map((cmd) => (
                <span key={cmd} className="shrink-0 text-stroke font-sans font-black tracking-tightest text-[12vw] leading-[0.9] transition-colors duration-300">
                  {cmd}<span className="mx-8 text-neon-blue">•</span>
                </span>
              ))}
            </div>
          ))}
        </div>
        <div className="pointer-events-none absolute inset-y-0 left-0 w-32 md:w-56 bg-gradient-to-r from-void to-transparent" />
        <div className="pointer-events-none absolute inset-y-0 right-0 w-32 md:w-56 bg-gradient-to-l from-void to-transparent" />
      </div>

      <div className="max-w-[1440px] mx-auto px-6 md:px-10 mt-16 md:mt-20 text-[11px] uppercase tracking-widest font-mono text-white/40 flex flex-wrap justify-between gap-4">
        <span>34 slash commands</span>
        <span>type &nbsp;<span className="text-white">/</span>&nbsp; to autocomplete</span>
        <span>see /help</span>
      </div>
    </section>
  );
}
