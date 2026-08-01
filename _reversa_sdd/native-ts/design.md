# Native TypeScript support — technical design

The local implementation mirrors the subset of Yoga layout semantics used by Ink. Nodes hold style/layout/children/measurement state; dirty propagation invalidates ancestors and measurement caching avoids repeated work. It is intentionally coupled to the renderer contract rather than presented as a generic browser layout engine. 🟢

Dependencies: `src/ink/` reconciler/layout pipeline. 🟢
