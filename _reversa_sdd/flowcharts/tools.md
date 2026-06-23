# Flowchart — Módulo Tools (Execução de Ferramentas)

> Gerado pelo Arqueólogo (Reversa) em 2026-06-23

```mermaid
flowchart TD
    A[Agent chama executeTool] --> B{Tool existe no toolMap?}
    B -->|não| C[Retorna "Unknown tool: name"]
    B -->|sim| D[validateToolArguments]
    D --> E{Validação ok?}
    E -->|não| F[Retorna erro com params válidos]
    E -->|sim| G[tool.execute args]
    G --> H{Exceção?}
    H -->|sim| I[Retorna "Error: message"]
    H -->|não| J[Retorna resultado string]
```

## Shell — Fluxo de Segurança

```mermaid
flowchart TD
    A[Shell.execute] --> B[isDestructive command]
    B --> C{Match em DESTRUCTIVE_PATTERNS?}
    C -->|sim| D{confirmHandler existe?}
    D -->|não| E[Retorna: blocked, no handler]
    D -->|sim| F[Pede confirmação ao user]
    F --> G{Confirmado?}
    G -->|não| H[Retorna: cancelled by user]
    G -->|sim| I[execa command]
    C -->|não| I
    I --> J{Sucesso?}
    J -->|sim| K[Retorna stdout+stderr truncado 50k chars]
    J -->|não| L[Retorna erro truncado 50k chars]
```

## WriteFile / PatchFile — Fluxo com Diff

```mermaid
flowchart TD
    A[WriteFile.execute / PatchFile.execute] --> B[assertSafePath]
    B --> C{Path seguro?}
    C -->|não| D[throw Error]
    C -->|sim| E[Lê conteúdo atual]
    E --> F{PatchFile: old_content encontrado?}
    F -->|0 matches| G[Erro: not found]
    F -->|>1 matches| H[Erro: ambíguo]
    F -->|1 match| I[Aplica substituição]
    I --> J[fs.writeFile]
    J --> K{Arquivo > 5000 linhas?}
    K -->|sim| L[Retorna summary JSON]
    K -->|não| M[computeDiff LCS]
    M --> N[Retorna JSON com diff lines]
```

## WebFetch — Proteção SSRF

```mermaid
flowchart TD
    A[WebFetch.execute] --> B{URL válida? https?://}
    B -->|não| C[Erro: invalid URL]
    B -->|sim| D[isBlockedUrl]
    D --> E{localhost/privado/metadata?}
    E -->|sim| F[Erro: blocked for security]
    E -->|não| G[fetch URL timeout 15s]
    G --> H{HTTP ok?}
    H -->|não| I[Erro: HTTP status]
    H -->|sim| J[stripHtml]
    J --> K[Retorna texto truncado 20k chars]
```

## SubAgent — Loop Independente

```mermaid
flowchart TD
    A[SubAgent.execute] --> B[Cria client com mesmo provider]
    B --> C[Monta system prompt + task]
    C --> D[Loop max 15 iterações]
    D --> E[client.chat.completions.create]
    E --> F{Tem tool_calls?}
    F -->|não| G[Retorna msg.content]
    F -->|sim| H[Para cada tool_call]
    H --> I{Permission deny?}
    I -->|sim| J[Append: blocked by rule]
    I -->|não| K[tool.execute]
    K --> L[Append tool result]
    L --> D
    D --> M{Max iterations?}
    M -->|sim| N[Retorna: max iterations reached]
```
