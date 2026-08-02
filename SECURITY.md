  Only the latest stable release receives security patches. We do not maintain
  older minor versions, so please upgrade to the newest release to stay safe.

  | Version | Supported          |
  | ------- | ------------------ |
  | 0.6.x   | ✅                 |
  | < 0.6   | ❌                 |

  > Running from source (`main`)? We recommend pulling frequently — security
  > fixes land in `main` before they are published to npm.

  ## Reporting a Vulnerability

  Please **do not** open a public issue for security problems. Use the GitHub
  Security Advisory flow instead, which keeps the report private until it is
  
  1. Go to **Security → Report a vulnerability** in the
     [repository](https://github.com/Hermenics/deepseek-code/security).
  2. Include as much as you can:
     - DeepSeek Code version (from `package.json` or `deepseek --version`)
     - Steps to reproduce
     - Impact and, if possible, a suggested fix
  3. You'll receive an acknowledgment within **72 hours**. We aim to ship a fix
     in the next release and will coordinate disclosure with you.

  ## Security Practices
  
  - **Credentials are never committed.** API keys (DeepSeek, AWS Bedrock,
    Google Vertex, etc.) are read from environment variables or a local config
    file that is git-ignored. `.env` files must never be added to the repo.
  - **Secrets are not logged.** Keys and tokens are kept out of log output
    during normal operation. If you spot one in a log, report it.
  - **The agent executes code.** DeepSeek Code runs shell commands and reads
    files as part of its tooling. Run it only in environments you trust, and
    review the commands it proposes.
  - **Dependencies are scanned.** The dependency tree (including the
    `@modelcontextprotocol/sdk`) is reviewed with security scanners on every
    release. Scanner findings that point at bundled upstream example code —
    which is never executed at runtime — are triaged as informational.
