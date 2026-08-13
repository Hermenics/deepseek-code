import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Github, Terminal, ArrowUpRight } from "lucide-react";
import useNpmVersion from "@/lib/useNpmVersion";
import useNpmDownloads from "@/lib/useNpmDownloads";
import ProductSwitcher from "@/components/ProductSwitcher";

export default function Header() {
  const version = useNpmVersion();
  const downloads = useNpmDownloads();
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <motion.header
      data-testid="site-header"
      initial={{ y: -60, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.9, delay: 0.1, ease: [0.76, 0, 0.24, 1] }}
      className={`fixed top-0 left-0 right-0 z-50 transition-colors duration-500 ${scrolled ? "bg-void/80 backdrop-blur-xl border-b border-white/10" : ""}`}
    >
      <div className="max-w-[1440px] mx-auto px-6 md:px-10 h-20 flex items-center justify-between">
        <ProductSwitcher
          triggerClassName="group flex shrink-0 items-center gap-2.5 whitespace-nowrap border-0 bg-transparent p-0 text-left font-mono text-[15px] tracking-tighter"
          contentClassName="product-switcher-menu z-50 min-w-28 border border-white/15 bg-[#050505] p-1 text-[12px] font-mono tracking-widest text-white shadow-lg shadow-black/20"
          itemClassName="block cursor-pointer px-3 py-2 text-white/60 outline-none transition-colors hover:bg-white/10 hover:text-white focus:bg-white/10 focus:text-white data-[disabled]:cursor-default data-[disabled]:text-white"
          testId="brand-mark"
          alignOffset={100}
        >
          <Terminal className="w-5 h-5 shrink-0 text-neon-blue" strokeWidth={1.5} />
          <span className="text-white">deepseek</span>
          <span className="flex items-center gap-1 text-white/40">
            <span>/code</span><span aria-hidden="true" className="product-switcher-chevron group-data-[state=open]:rotate-90">&gt;</span>
          </span>
          <span className="ml-2 text-[11px] text-white/40 border border-white/10 px-2 py-1 tracking-widest">{version}</span>
        </ProductSwitcher>

        <nav className="hidden lg:flex items-center gap-6 xl:gap-10 text-[12px] uppercase tracking-widest font-mono text-white/60">
          <a href="#chapter-i" className="hover:text-white transition-colors">i. tools</a>
          <a href="#chapter-ii" className="hover:text-white transition-colors">ii. orchestration</a>
          <a href="#chapter-iii" className="hover:text-white transition-colors">iii. providers</a>
          <a href="#quickstart" className="hover:text-white transition-colors">install</a>
        </nav>

        <div className="flex items-center gap-3">
          <a href="https://www.npmjs.com/package/@hermenics/deepseek-code" target="_blank" rel="noreferrer" data-testid="header-npm" title="npm downloads in the last year" className="hidden lg:flex items-center gap-2.5 text-[12px] uppercase tracking-widest font-mono text-white/70 hover:text-white transition-colors border border-white/10 hover:border-white/30 px-4 py-3">
            <svg aria-hidden="true" viewBox="0 0 100 100" className="w-5 h-5 text-current">
              <path d="M16 16h68v68H61V32H47v52H16z" fill="currentColor" />
            </svg>
            <span className="text-white/40">{downloads}</span>
          </a>
          <a href="https://github.com/Hermenics/deepseek-code" target="_blank" rel="noreferrer" data-testid="header-github" className="hidden xl:flex items-center gap-2.5 text-[12px] uppercase tracking-widest font-mono text-white/70 hover:text-white transition-colors border border-white/10 hover:border-white/30 px-4 py-3">
            <Github className="w-4 h-4" strokeWidth={1.5} />github
          </a>
          <a href="#quickstart" data-testid="header-install" className="group flex items-center gap-2.5 text-[12px] uppercase tracking-widest font-mono bg-white text-black hover:bg-neon-blue hover:text-white transition-colors px-5 py-3">
            install
            <ArrowUpRight className="w-4 h-4 group-hover:translate-x-[2px] group-hover:-translate-y-[2px] transition-transform" strokeWidth={1.5} />
          </a>
        </div>
      </div>
    </motion.header>
  );
}
