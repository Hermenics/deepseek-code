import React, { useState } from "react";
import { motion } from "framer-motion";
import { Check, Copy, Terminal as TerminalIcon } from "lucide-react";

const STEPS = [
  { n: "01", label: "install", cmd: "npm install -g @hermenics/deepseek-code", hint: "requires node ≥ 18" },
  { n: "02", label: "configure", cmd: "deepseek", hint: "choose provider · api key · default model" },
  { n: "03", label: "start", cmd: "deepseek \"explain this project\"", hint: "or pipe: echo \"explain this\" | deepseek --pipe" },
];

function CopyButton({ text, id }) {
  const [copied, setCopied] = useState(false);
  return (
    <button data-testid={`copy-${id}`} onClick={async () => { try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch (e) { console.error(e); } }} className="group flex items-center gap-2 text-[10px] uppercase tracking-widest font-mono text-white/50 hover:text-neon-blue transition-colors">
      {copied ? <><Check className="w-3.5 h-3.5" strokeWidth={1.75} />copied</> : <><Copy className="w-3.5 h-3.5" strokeWidth={1.75} />copy</>}
    </button>
  );
}

export default function Quickstart() {
  return (
    <section id="quickstart" data-testid="quickstart" className="relative py-32 md:py-48 border-t border-white/10">
      <div className="max-w-[1440px] mx-auto px-6 md:px-10">
        <div className="grid md:grid-cols-12 gap-8 md:gap-12 mb-16 md:mb-20">
          <div className="md:col-span-4">
            <motion.div initial={{ opacity: 0, x: -30 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ duration: 1.2, ease: [0.76, 0, 0.24, 1] }} className="font-serif italic text-white text-[24vw] md:text-[14vw] leading-[0.8]">
              IV<span className="text-neon-blue not-italic font-sans font-normal text-[0.15em] align-super">.</span>
            </motion.div>
          </div>
          <div className="md:col-span-8 flex flex-col justify-end">
            <div className="text-[11px] uppercase tracking-widest font-mono text-neon-blue mb-6">— chapter iv · begin</div>
            <h2 className="font-sans font-black tracking-tightest text-white text-4xl sm:text-5xl md:text-6xl lg:text-7xl leading-[0.95]">Three lines<br /><span className="font-serif italic font-normal text-white/70">to a working agent.</span></h2>
          </div>
        </div>

        <div className="relative">
          <div className="space-y-4">
            {STEPS.map((s, i) => (
              <motion.div key={s.n} initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-60px" }} transition={{ duration: 0.7, delay: i * 0.1 }} className="group relative border border-white/10 bg-void hover:bg-elevated/60 transition-colors">
                <div className="grid md:grid-cols-12 gap-4 items-center px-6 md:px-8 py-6 md:py-7">
                  <div className="md:col-span-1 font-mono text-xs uppercase tracking-widest text-white/40">{s.n}</div>
                  <div className="md:col-span-2 font-mono text-xs uppercase tracking-widest text-white/60">{s.label}</div>
                  <div className="md:col-span-6 font-mono text-sm md:text-base text-white flex items-center gap-2 overflow-hidden">
                    <TerminalIcon className="w-4 h-4 text-neon-blue shrink-0" strokeWidth={1.5} />
                    <span className="truncate"><span className="text-white/40">$</span> {s.cmd}</span>
                  </div>
                  <div className="md:col-span-2 font-mono text-[11px] text-white/40 hidden md:block">{s.hint}</div>
                  <div className="md:col-span-1 flex justify-end"><CopyButton text={s.cmd} id={s.label} /></div>
                </div>
                <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-neon-blue scale-y-0 group-hover:scale-y-100 origin-top transition-transform duration-500" />
              </motion.div>
            ))}
          </div>

          <svg aria-hidden="true" className="gutter-flourish pointer-events-none absolute inset-x-0 top-0 h-[calc(100%-1rem)] w-full overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none">
            <path d="M-3 7 C-16 25 -15 55 -3 87" fill="none" stroke="currentColor" strokeWidth="0.24" strokeLinecap="round" className="text-white" />
            <path d="M-3.55 81.3 L-3 87" fill="none" stroke="currentColor" strokeWidth="0.24" strokeLinecap="round" className="text-white" />
            <path d="M-4.95 85.6 L-3 87" fill="none" stroke="currentColor" strokeWidth="0.24" strokeLinecap="round" className="text-white" />
          </svg>

          <div className="mt-16 grid md:grid-cols-2 gap-4 md:gap-6">
            {[{ k: "or curl", mobileK: "or install it with curl", v: "curl -fsSL https://deepseek-code.vercel.app/install.sh | bash" }, { k: "or bun", mobileK: "or install it with bun", v: "bun add -g @hermenics/deepseek-code" }].map((o) => (
              <div key={o.k} className="border border-white/10 p-5 md:p-6 bg-void hover:border-white/25 transition-colors">
                <div className="text-[10px] uppercase tracking-widest font-mono text-white/40 mb-2"><span className="md:hidden">{o.mobileK || o.k}</span><span className="hidden md:inline">{o.k}</span></div>
                <div className="font-mono text-sm text-white/80 break-words">{o.v}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
