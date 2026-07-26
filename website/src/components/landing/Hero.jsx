import React, { useRef } from "react";
import { motion, useScroll, useTransform } from "framer-motion";
import { ArrowDown, Github, Copy } from "lucide-react";
import TerminalMock from "./TerminalMock";
import useNpmVersion from "@/lib/useNpmVersion";

const EASE = [0.76, 0, 0.24, 1];

function RevealLine({ children, delay = 0 }) {
  return (
    <span className="reveal-mask">
      <motion.span className="inline-block" initial={{ y: "110%" }} animate={{ y: "0%" }} transition={{ duration: 1.1, ease: EASE, delay }}>
        {children}
      </motion.span>
    </span>
  );
}

export default function Hero() {
  const version = useNpmVersion();
  const ref = useRef(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const rotateX = useTransform(scrollYProgress, [0, 1], [0, 18]);
  const scale = useTransform(scrollYProgress, [0, 1], [1, 0.86]);
  const y = useTransform(scrollYProgress, [0, 1], [0, 120]);
  const opacity = useTransform(scrollYProgress, [0, 0.9], [1, 0.3]);

  return (
    <section id="top" ref={ref} data-testid="hero" className="relative pt-36 md:pt-44 pb-24 md:pb-32 overflow-hidden">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute top-[10%] left-[8%] w-[36rem] h-[36rem] rounded-full bg-neon-blue/10 blur-[140px]" />
        <div className="absolute top-[30%] right-[6%] w-[26rem] h-[26rem] rounded-full bg-neon-cyan/5 blur-[120px]" />
      </div>

      <div className="max-w-[1440px] mx-auto px-6 md:px-10">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, delay: 0.4 }} className="flex flex-wrap items-center gap-4 text-[11px] uppercase tracking-widest font-mono text-white/40 mb-10">
          <span className="flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-neon-green" />{version} · apache-2.0</span>
          <span className="text-white/20">/</span><span>@hermenics/deepseek-code</span><span className="text-white/20">/</span><span>bun · node ≥18</span>
        </motion.div>

        <h1 data-testid="hero-title" className="font-sans font-black leading-[0.86] tracking-tightest text-white text-[12vw] md:text-[9.5vw] lg:text-[8.4vw]">
          <div className="block"><RevealLine delay={0.15}>INTELLIGENCE</RevealLine></div>
          <div className="block pl-[6vw] md:pl-[10vw]"><RevealLine delay={0.3}><span className="font-serif italic font-normal text-white/70 pr-[0.12em]">in the</span></RevealLine></div>
          <div className="block"><RevealLine delay={0.45}>TERMINAL<span className="text-neon-blue">.</span></RevealLine></div>
        </h1>

        <div className="mt-14 grid md:grid-cols-12 gap-8 md:gap-16 items-end">
          <motion.p initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.9, delay: 0.9, ease: EASE }} className="md:col-span-6 font-mono text-sm md:text-[15px] leading-relaxed text-white/70 max-w-lg">
            <span className="text-neon-blue">›</span> An autonomous coding agent that reads, writes, executes and orchestrates — inside a rich TUI built on React 19 and a custom Ink renderer. One interface. Every model. Zero cloud lock-in.
          </motion.p>
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.9, delay: 1.05, ease: EASE }} className="md:col-span-6 md:col-start-7 flex flex-wrap items-center gap-4">
            <a href="#quickstart" data-testid="hero-install-button" className="group inline-flex items-center gap-3 bg-white text-black hover:bg-neon-blue hover:text-white transition-colors px-6 py-4 font-mono text-xs uppercase tracking-widest"><Copy className="w-3.5 h-3.5" strokeWidth={1.75} />npm i -g @hermenics/deepseek-code</a>
            <a href="https://github.com/Hermenics/deepseek-code" target="_blank" rel="noreferrer" data-testid="hero-github-button" className="inline-flex items-center gap-3 border border-white/20 hover:border-white text-white transition-colors px-6 py-4 font-mono text-xs uppercase tracking-widest hover:bg-white/5"><Github className="w-3.5 h-3.5" strokeWidth={1.75} />read the source</a>
          </motion.div>
        </div>
      </div>

      <div className="relative mt-24 md:mt-32 px-6 md:px-10 [perspective:1400px]">
        <motion.div style={{ rotateX, scale, y, opacity }} className="max-w-[1440px] mx-auto [transform-style:preserve-3d] origin-top"><TerminalMock /></motion.div>
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.6, duration: 1 }} className="mt-16 flex items-center justify-center gap-3 text-[10px] uppercase tracking-widest font-mono text-white/40"><ArrowDown className="w-3 h-3" strokeWidth={1.5} />scroll — the manifesto begins</motion.div>
      </div>
    </section>
  );
}
