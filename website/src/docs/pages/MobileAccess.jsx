import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "what", label: "What /mobile does" },
  { id: "open", label: "Open and navigate" },
  { id: "privacy", label: "Privacy and connectivity" },
  { id: "troubleshooting", label: "Troubleshooting" },
];

export default function MobileAccess() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Interface</span><span className="sep">/</span><span className="current">Mobile app QR</span>
        </nav>
        <div className="hero">
          <h1>Mobile app QR codes</h1>
          <p className="tagline">Open the official DeepSeek mobile app store pages from a terminal-friendly QR view.</p>
        </div>

        <section id="what">
          <h2><span className="anchor">#</span>What /mobile does</h2>
          <p>
            <code className="inline">/mobile</code> renders a QR code for either the iOS App Store or Google
            Play listing of the DeepSeek chat app. The aliases <code className="inline">/ios</code> and
            <code className="inline">/android</code> open the same selector; they do not preselect a platform.
          </p>
          <CodeBlock lang="bash">{`/mobile
# aliases
/ios
/android`}</CodeBlock>
          <Note>
            This screen does not pair your phone with the CLI, expose the terminal session remotely, or
            transfer prompts, files, credentials, or conversation history.
          </Note>
        </section>

        <section id="open">
          <h2><span className="anchor">#</span>Open and navigate</h2>
          <p>
            The selector begins on iOS. Tab or any arrow key toggles between iOS and Android. Scan the QR
            code or type the URL printed below it, then press Esc or <code className="inline">q</code> to
            return to the DeepSeek Code session.
          </p>
          <div className="doc-table-wrap"><table className="doc-table">
            <thead><tr><th style={{ width: "34%" }}>Key</th><th>Action</th></tr></thead>
            <tbody>
              <tr><td>Tab, ←, →, ↑, or ↓</td><td>Toggle between the iOS and Android store links.</td></tr>
              <tr><td>Esc or <code className="inline">q</code></td><td>Close the QR screen.</td></tr>
            </tbody>
          </table></div>
        </section>

        <section id="privacy">
          <h2><span className="anchor">#</span>Privacy and connectivity</h2>
          <p>
            QR generation happens locally from two fixed public store URLs. Opening or scanning the result
            contacts Apple or Google through the device you use; merely rendering the QR screen does not
            start a CLI network connection to either store.
          </p>
          <p>
            The mobile app is a separate product surface. Its account, conversations, capabilities, and
            privacy behavior are not the same as the local terminal session documented here.
          </p>
        </section>

        <section id="troubleshooting">
          <h2><span className="anchor">#</span>Troubleshooting</h2>
          <p>
            If QR generation fails, the screen prints the error and keeps Esc and <code className="inline">q</code>
            available. If the code is too dense to scan, enlarge the terminal font or use the complete URL
            shown beneath it. A narrow terminal may wrap the QR; widen the window before scanning.
          </p>
        </section>
      </main>
      <Toc items={TOC} />
    </>
  );
}
