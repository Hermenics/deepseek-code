import React from "react";
import { motion } from "framer-motion";
import { ArrowUpRight } from "lucide-react";
import Chapter from "./Chapter";

const PROVIDERS = [
  { id: "01", name: "DeepSeek", endpoint: "api.deepseek.com", auth: "api key", model: "deepseek-v4-flash", accent: "text-neon-blue" },
  { id: "02", name: "Bedrock", endpoint: "bedrock-runtime.{region}.amazonaws.com", auth: "aws sigv4", model: "us.deepseek.r1-v1:0", accent: "text-neon-amber" },
  { id: "03", name: "Vertex", endpoint: "{location}-aiplatform.googleapis.com", auth: "gcp service account", model: "deepseek-ai/deepseek-r1", accent: "text-neon-cyan" },
  { id: "04", name: "Local", endpoint: "localhost:11434 · ollama · lm studio", auth: "none", model: "llama3 (default)", accent: "text-neon-green" },
];

export default function ChapterIII() {
  return (
    <Chapter
      id="chapter-iii"
      numeral="III"
      kicker="the surface area"
      title={
        <>
          Four providers.
          <br />
          <span className="font-serif italic font-normal text-white/70">
            One interface.
          </span>
        </>
      }
      lead="Cloud, hyperscaler, or your laptop. A single OpenAI-compatible factory adapts each transport — including a prompt-engineered tool-calling shim for Bedrock R1."
    >
      <div data-testid="providers-list" className="border-t border-white/10">
        {PROVIDERS.map((p, i) => (
          <motion.div
            key={p.name}
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.7, delay: i * 0.08, ease: [0.76, 0, 0.24, 1] }}
            className="group relative grid grid-cols-12 items-baseline gap-4 py-8 md:py-12 border-b border-white/10 hover:bg-elevated/40 transition-colors"
          >
            <div className="col-span-2 md:col-span-1 font-mono text-[11px] uppercase tracking-widest text-white/40">{p.id}</div>
            <div className="col-span-10 md:col-span-4">
              <div className="font-sans font-black tracking-tightest text-white text-4xl md:text-6xl lg:text-7xl leading-none group-hover:translate-x-2 transition-transform duration-500">
                {p.name}<span className={`${p.accent} font-serif italic font-normal`}>.</span>
              </div>
            </div>
            <div className="col-span-12 md:col-span-6 grid md:grid-cols-3 gap-4 font-mono text-xs">
              <Meta k="endpoint" v={p.endpoint} /><Meta k="auth" v={p.auth} /><Meta k="default model" v={p.model} accent={p.accent} />
            </div>
            <div className="col-span-12 md:col-span-1 flex justify-end">
              <ArrowUpRight className="w-6 h-6 text-white/30 group-hover:text-white group-hover:-translate-y-1 group-hover:translate-x-1 transition-all" strokeWidth={1.5} />
            </div>
          </motion.div>
        ))}
      </div>

      <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.8 }} className="mt-16 grid md:grid-cols-2 border border-white/10">
        <div className="p-8 md:p-12 border-b md:border-b-0 md:border-r border-white/10">
          <div className="text-[11px] uppercase tracking-widest font-mono text-neon-blue mb-4">engineering note</div>
          <h3 className="font-sans font-bold text-white text-2xl md:text-3xl leading-tight tracking-tight">Tool calling, emulated when the wire doesn&apos;t speak it.</h3>
          <p className="mt-5 font-mono text-sm text-white/60 leading-relaxed">
            DeepSeek R1 on Bedrock lacks native tool calling. Instead of dropping support, we inject XML tool definitions into the system prompt and parse <span className="text-neon-amber">&lt;tool_call&gt;</span> blocks from the response &mdash; indistinguishable, upstream.
          </p>
        </div>
        <div className="p-8 md:p-12 font-mono text-xs bg-void">
          <div className="text-[10px] uppercase tracking-widest text-white/40 mb-4">system prompt · injected</div>
          <pre className="text-white/80 leading-relaxed whitespace-pre-wrap">
{`<tools>
  <tool name="write_file">
    <param name="path" type="string" />
    <param name="content" type="string" />
  </tool>
  <tool name="shell">
    <param name="cmd" type="string" />
  </tool>
</tools>

<tool_call>
  <name>`}<span className="text-neon-cyan">shell</span>{`</name>
  <args>{`}<span className="text-neon-amber">{`"cmd": "bun test"`}</span>{`</args>
</tool_call>`}
          </pre>
        </div>
      </motion.div>
    </Chapter>
  );
}

function Meta({ k, v, accent }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-white/40 mb-1">{k}</div>
      <div className={`${accent || "text-white/80"} break-words`}>{v}</div>
    </div>
  );
}
