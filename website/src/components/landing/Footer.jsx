import React from "react";
import { Github, ExternalLink, Package } from "lucide-react";
import useNpmVersion from "@/lib/useNpmVersion";

export default function Footer() {
  const version = useNpmVersion();
  return (
    <footer data-testid="site-footer" className="relative border-t border-white/10 pt-24 pb-10">
      <div className="max-w-[1440px] mx-auto px-6 md:px-10">
        <div className="relative left-0 md:-left-[10vw] whitespace-nowrap font-sans font-black tracking-tightest text-white leading-[0.85] text-[14vw] md:text-[17vw] mb-16 md:mb-24">
          HERMENICS<span className="text-neon-blue font-serif italic font-normal">.</span>
        </div>

        <div className="grid md:grid-cols-12 gap-8 md:gap-6 pb-16 border-b border-white/10">
          <div className="md:col-span-4">
            <div className="text-[10px] uppercase tracking-widest font-mono text-white/40 mb-4">— the pitch</div>
            <p className="font-mono text-sm text-white/70 leading-relaxed max-w-sm">An open-source, multi-provider coding agent that lives inside your terminal. Compose it. Extend it. Own it.</p>
          </div>

          <FooterCol title="project" links={[
            { label: "GitHub", href: "https://github.com/Hermenics/deepseek-code", icon: Github, external: true },
            { label: "npm", href: "https://www.npmjs.com/package/@hermenics/deepseek-code", icon: Package, external: true },
            { label: "Apache-2.0", href: "https://www.apache.org/licenses/LICENSE-2.0", external: true },
            { label: "Changelog", href: "https://github.com/Hermenics/deepseek-code/releases", external: true },
          ]} />

          <FooterCol title="chapters" links={[
            { label: "I. Tools", href: "#chapter-i" },
            { label: "II. Orchestration", href: "#chapter-ii" },
            { label: "III. Providers", href: "#chapter-iii" },
            { label: "IV. Install", href: "#quickstart" },
          ]} />

          <FooterCol title="providers" links={[
            { label: "DeepSeek API", href: "#" },
            { label: "Amazon Bedrock", href: "#" },
            { label: "Google Vertex AI", href: "#" },
            { label: "Local / Ollama", href: "#" },
          ]} />
        </div>

        <div className="mt-10 grid md:grid-cols-3 gap-6 items-center text-[10px] uppercase tracking-widest font-mono text-white/40">
          <div className="flex items-center gap-3"><span className="w-1.5 h-1.5 rounded-full bg-neon-green animate-pulse" /><span>{version} · stable</span></div>
          <div className="text-center">© {new Date().getFullYear()} hermenics · apache-2.0</div>
          <div className="md:text-right">crafted for the command line</div>
        </div>

        <div className="mt-14 border-t border-white/10 pt-8 font-mono text-[11px] text-white/40 flex flex-wrap items-center gap-2">
          <span className="text-neon-blue">›</span>
          <span>echo &quot;the terminal is not a fallback. it is the frontier.&quot;</span>
          <span className="inline-block w-[7px] h-[13px] bg-white/60 blink translate-y-[1px] ml-1" />
        </div>
      </div>
    </footer>
  );
}

function FooterCol({ title, links }) {
  return (
    <div className="md:col-span-2 lg:col-span-2 md:col-start-auto">
      <div className="text-[10px] uppercase tracking-widest font-mono text-white/40 mb-4">{title}</div>
      <ul className="space-y-3">
        {links.map((l) => {
          const Icon = l.icon;
          return (
            <li key={l.label}>
              <a href={l.href} target={l.external ? "_blank" : undefined} rel={l.external ? "noreferrer" : undefined} data-testid={`footer-link-${l.label.toLowerCase().replace(/\W+/g, "-")}`} className="group inline-flex items-center gap-2 font-mono text-sm text-white/80 hover:text-neon-blue transition-colors">
                {Icon && <Icon className="w-3.5 h-3.5" strokeWidth={1.5} />}
                <span>{l.label}</span>
                {l.external && <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" strokeWidth={1.5} />}
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
