import React from "react";
import { motion } from "framer-motion";

const EASE = [0.76, 0, 0.24, 1];

export default function Chapter({
  id,
  numeral,
  kicker,
  title,
  lead,
  children,
}) {
  return (
    <section id={id} data-testid={`chapter-${id}`} className="relative py-32 md:py-48 border-t border-white/10">
      <div className="max-w-[1440px] mx-auto px-6 md:px-10">
        <div className="grid md:grid-cols-12 gap-8 md:gap-12 mb-16 md:mb-24">
          <div className="md:col-span-4">
            <motion.div
              initial={{ opacity: 0, x: -30 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true, margin: "-100px" }}
              transition={{ duration: 1.2, ease: EASE }}
              className="font-serif italic text-white text-[24vw] md:text-[14vw] leading-[0.8]"
            >
              {numeral}
              <span className="text-neon-blue not-italic font-sans font-normal text-[0.15em] align-super">.</span>
            </motion.div>
          </div>

          <div className="md:col-span-8 flex flex-col justify-end">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-100px" }}
              transition={{ duration: 0.8, delay: 0.1, ease: EASE }}
              className="text-[11px] uppercase tracking-widest font-mono text-neon-blue mb-6"
            >
              — chapter {numeral.toLowerCase()} · {kicker}
            </motion.div>
            <motion.h2
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-100px" }}
              transition={{ duration: 1, delay: 0.2, ease: EASE }}
              className="font-sans font-black tracking-tightest text-white text-4xl sm:text-5xl md:text-6xl lg:text-7xl leading-[0.95]"
            >
              {title}
            </motion.h2>
            {lead && (
              <motion.p
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-100px" }}
                transition={{ duration: 0.9, delay: 0.35, ease: EASE }}
                className="mt-8 max-w-2xl font-mono text-sm leading-relaxed text-white/60"
              >
                {lead}
              </motion.p>
            )}
          </div>
        </div>

        {children}
      </div>
    </section>
  );
}
