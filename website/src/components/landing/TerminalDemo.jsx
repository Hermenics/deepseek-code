import React from "react";
import TerminalMock from "./TerminalMock";

export default function TerminalDemo() {
  return (
    <div className="tm-demo">
      <div className="tm-demo-titlebar" aria-hidden="true">
        <span className="tm-demo-lights"><i /><i /><i /></span>
        <span>deepseek — ~/csv-app</span>
      </div>
      <TerminalMock />
      <style>{`
        .tm-demo { width: 100%; overflow: hidden; border: 1px solid #34343e; border-radius: 10px; background: #0d1117; color: #f3f6fb; box-shadow: 0 20px 60px rgba(0,0,0,.42); }
        .tm-demo-titlebar { position: relative; display: flex; align-items: center; height: 34px; padding: 0 12px; border-bottom: 1px solid #34343e; background: #1e1e2e; color: #a5a5b3; font: 11px 'JetBrains Mono', 'SF Mono', monospace; }
        .tm-demo-titlebar > span:last-child { position: absolute; left: 50%; transform: translateX(-50%); white-space: nowrap; }
        .tm-demo-lights { display: flex; gap: 7px; }
        .tm-demo-lights i { width: 10px; height: 10px; border-radius: 50%; background: #ff5f56; }
        .tm-demo-lights i:nth-child(2) { background: #ffbd2e; }
        .tm-demo-lights i:nth-child(3) { background: #27c93f; }
      `}</style>
    </div>
  );
}
