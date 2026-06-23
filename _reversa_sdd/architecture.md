# Arquitetura — deepseek-code

> Gerado pelo Arquiteto (Reversa) em 2026-06-23
> Escala de confiança: 🟢 CONFIRMADO | 🟡 INFERIDO | 🔴 LACUNA

---

## Visão Geral

**DeepSeek Code** é uma CLI interativa (TUI) para assistência de programação com IA, análoga ao Claude Code. Roda em terminal via Bun, usa React (Ink fork) para renderizar a interface, e se comunica com modelos DeepSeek (ou compatíveis) via OpenAI SDK.

### Padrão Arquitetural

🟢 CONFIRMADO — **Arquitetura em camadas com event loop reativo**:

```
┌─────────────────────────────────────────────────────┐
│                    CLI Entry                         │
│        (cli.tsx → React root → App component)       │
├─────────────────────────────────────────────────────┤
│                  UI Layer (React/Ink)                │
│  InputBox, MessageList, StatusBar, ToolUseDisplay   │
├─────────────────────────────────────────────────────┤
│                 Agent Layer (Core)                   │
│  Agent class: loop, tools, permissions, compact     │
├─────────────────────────────────────────────────────┤
│               Provider Layer (LLM)                  │
│  DeepSeek API, Bedrock, Vertex, Local, Proxy        │
├─────────────────────────────────────────────────────┤
│              Infrastructure Layer                    │
│  Settings, Hooks, State, Session, MCP               │
└─────────────────────────────────────────────────────┘
```

### Princípios Arquiteturais

1. **Single-process** — Tudo roda em um processo Bun (exceto o proxy que é co-hosted)
2. **Stateless LLM** — Cada request envia contexto completo (sem server-side memory)
3. **File-based persistence** — JSON em `~/.deepseek/` (nenhum banco de dados)
4. **Security by default** — Sandbox de filesystem, SSRF protection, permission system
5. **Provider-agnostic** — OpenAI SDK como abstração; providers plugáveis

---

## Dívidas Técnicas

| # | Área | Descrição | Severidade |
|---|------|-----------|------------|
| DT1 | Tools | `computeDiff` duplicado identicamente em WriteFile e PatchFile | Baixa |
| DT2 | Proxy | Complexidade elevada do orchestrator (~200 linhas de SSE parsing) | Média |
| DT3 | Ink fork | ~130 arquivos sem sync com upstream — bugs podem divergir | Média |
| DT4 | Testes | Sem testes E2E que exercitem o loop completo do agente | Alta |
| DT5 | Proxy | Rate limiting referenciado mas implementação não auditada | Baixa |
| DT6 | Agent | Classe Agent com 1093 linhas — candidata a decomposição | Média |
| DT7 | Types | `package-lock.json` e `bun.lock` coexistem (potencial de drift) | Baixa |
