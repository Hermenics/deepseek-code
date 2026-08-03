import { Note, Toc } from "../Layout";
import RELEASES from "../data/releases.json";

const TOC = RELEASES.map((r) => ({
  id: "v" + r.version.replace(/\./g, "-"),
  label: r.version,
}));

export default function Changelog() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Reference</span><span className="sep">/</span><span className="current">Changelog</span>
        </nav>

        <div className="hero">
          <h1>Changelog</h1>
          <p className="tagline">
            Every release from {RELEASES[0]?.version} back to the very first commit — {RELEASES.length} versions, one product.
          </p>
        </div>

        <Note>
          Every release, version by version, is in the{" "}
          <a href="https://github.com/Hermenics/deepseek-code/blob/main/CHANGELOG.md">CHANGELOG.md</a>{" "}
          of the repository. Only the latest stable release receives security patches — upgrade to
          stay safe.
        </Note>

        {RELEASES.map((r) => (
          <section key={r.version} id={"v" + r.version.replace(/\./g, "-")}>
            <h2><span className="anchor">#</span>{r.version}</h2>
            <ul className="release-list">
              {r.changes.map((c) => <li key={c}>{c}</li>)}
            </ul>
          </section>
        ))}
      </main>

      <Toc items={TOC} />
    </>
  );
}
