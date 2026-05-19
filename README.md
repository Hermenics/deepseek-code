<div align="center">

<img src="https://raw.githubusercontent.com/Aethelics/deepseek-code2/main/deepseek-code.png" alt="DeepSeek Code" height="250"/>

<br/>

<p>
  <a href="https://www.npmjs.com/package/@aethelics/deepseek-code"><img src="https://img.shields.io/npm/v/@aethelics/deepseek-code?style=for-the-badge&labelColor=0d1117&color=cyan" alt="npm version" /></a>
  <img src="https://img.shields.io/badge/model-DeepSeek-4A90D9?style=for-the-badge&labelColor=0d1117" alt="DeepSeek" />
  <img src="https://img.shields.io/badge/license-Apache--2.0-22c55e?style=for-the-badge&labelColor=0d1117" alt="Apache 2.0" />
</p>

<p><strong>An AI-powered coding assistant that lives in your terminal.</strong></p>

</div>

---

<div align="center">
  <img src="https://raw.githubusercontent.com/Aethelics/deepseek-code2/main/demo.gif" alt="DeepSeek Code demo" width="80%" />
</div>

## Get started

```bash
npm install -g @aethelics/deepseek-code
```

Then run `deepseek` inside any project. On first run you'll pick a **provider** and configure authentication.

## Providers & authentication

| Provider | How to authenticate | Env / config keys |
|---|---|---|
| **DeepSeek API** (default) | API key from [platform.deepseek.com](https://platform.deepseek.com/api_keys) | `DEEPSEEK_API_KEY`, `DEEPSEEK_BASE_URL` |
| **Amazon Bedrock** | AWS IAM credentials via `~/.aws/credentials` | `AWS_REGION`, `AWS_PROFILE` |
| **Google Vertex AI** | GCP service account JSON key | `GCP_PROJECT`, `GCP_LOCATION`, `GCP_CREDENTIALS` |
| **Local (Ollama / LM Studio)** | No auth — just point to your local endpoint | `LOCAL_BASE_URL`, `LOCAL_MODEL` |
| **OAuth (beta)** | Login via browser on chat.deepseek.com | Auto-configured |

All config is saved to `~/.deepseek/config.json`. You can also set any config key as an environment variable.

## Models

Switch between models at any time with `/model`:

| Model ID | Description | Context |
|---|---|---|
| `deepseek-v4-flash` | Fast, general purpose (default) | 128K |
| `deepseek-v4-pro` | Advanced reasoning | 128K |
| `deepseek-reasoner` | Chain-of-thought reasoning (R1) | 128K |

Each provider also exposes provider-specific models (Bedrock, Vertex, local).

## What it does

DeepSeek Code is an agentic coding tool with a TUI that lives in your terminal. It understands your codebase and helps you code faster through natural language — reading and writing files, running shell commands, searching code, fetching URLs, managing git, and more.

## TUI behavior

- Runs on the terminal **alternate screen** so the viewport is clean and scrolling works smoothly without truncation.
- Thinking output is streamed as full multiline blocks and persisted after each response.
- To force main-screen mode (experimental): `OTUI_USE_ALTERNATE_SCREEN=0 deepseek`

## Reporting bugs

File a [GitHub issue](https://github.com/Aethelics/deepseek-code2/issues) or use `/help` inside the TUI.

---

<div align="center">
  <p>Made with ❤️ by <a href="https://github.com/Marcelo-Henry">Marcelo</a></p>
</div>

---


<div align="center">
  <img src="https://raw.githubusercontent.com/Aethelics/deepseek-code2/main/demo.gif" alt="DeepSeek Code demo" width="80%" />
</div>

## Get started

1. Install DeepSeek Code:

```bash
npm install -g @aethelics/deepseek-code
```

2. Navigate to your project and run `deepseek`.

On first run you'll be asked for your [DeepSeek API key](https://platform.deepseek.com/api_keys), language and theme.

## What it does

DeepSeek Code is an agentic coding tool with a beautiful terminal UI. It understands your codebase and helps you code faster through natural language — reading and writing files, running shell commands, searching code, fetching URLs, managing git, and more.

It supports two models: **DeepSeek-V4-Flash** (`deepseek-v4-flash`) for fast general use, **DeepSeek-V4-Pro** (`deepseek-v4-pro`) for complext tasks, and **DeepSeek-R1** (`deepseek-reasoner`) for complex chain-of-thought reasoning. Switch between them at any time with `/model`.

## TUI behavior

- The TUI now runs on the terminal **main screen** (`screenMode: "main-screen"`), so terminal scrollback keeps chat history visible instead of limiting everything to an alternate-screen viewport.
- Thinking output is rendered as a full multiline block while streaming and is persisted in chat history after each response/tool step.
- To force alternate-screen mode, set `OTUI_USE_ALTERNATE_SCREEN=1` before running `deepseek`.

## Reporting bugs

File a [GitHub issue](https://github.com/Aethelics/deepseek-code2/issues) or use the `/help` command inside the TUI.

---

<div align="center">
  <p>Made with ❤️ by <a href="https://github.com/Marcelo-Henry">Marcelo</a></p>
</div>
