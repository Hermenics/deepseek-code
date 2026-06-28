# Remote Control Architecture — DeepSeek Code

## Status: APPROVED (v2 — revisão Architect)
## Prioridade: P0-CRÍTICO

---

## 1. Estrutura de Diretórios (Monorepo)

```
deepseek-code/
├── packages/
│   ├── remote-control/         ← Tipos compartilhados + crypto helpers
│   │   ├── src/
│   │   │   ├── types.ts        ← Frame discriminated union + interfaces
│   │   │   ├── crypto.ts       ← Curve25519 + XSalsa20-Poly1305 (tweetnacl)
│   │   │   ├── frames.ts       ← Encode/decode/validate frames + seq logic
│   │   │   └── index.ts        ← Re-export público
│   │   ├── package.json        ← { "name": "@hermenics/remote-control" }
│   │   └── tsconfig.json
│   │
│   ├── relay-server/           ← Bun HTTP/WebSocket relay server
│   │   ├── src/
│   │   │   ├── server.ts       ← Bun.serve (HTTP + WebSocket upgrade)
│   │   │   ├── sessions.ts     ← Session registry + buffer (500 frames)
│   │   │   ├── auth.ts         ← Challenge-response device auth
│   │   │   ├── rate-limit.ts   ← Token bucket per IP/device
│   │   │   ├── store.ts        ← SQLite via bun:sqlite (MVP)
│   │   │   └── config.ts       ← Env config
│   │   ├── package.json        ← { "name": "@hermenics/relay-server" }
│   │   └── tsconfig.json
│   │
│   └── mobile-app/             ← React Native / Expo (placeholder)
│       ├── app/
│       ├── package.json
│       └── app.json
│
├── src/commands/rc/
│   └── index.ts                ← /remote-control (alias /rc)
│
├── src/remote/                 ← CLI-side remote control logic
│   ├── bridge.ts              ← WebSocket client → relay
│   ├── pairing.ts            ← Fluxo QR + pareamento
│   ├── trust-store.ts        ← DeviceTrust persistence (~/.deepseek/devices.json)
│   ├── session-keys.ts       ← Ephemeral key derivation (Noise-like)
│   ├── crypto.ts             ← CLI-side key management (device.key)
│   ├── qr.ts                 ← QR code terminal rendering
│   └── index.ts              ← Re-export + start/stop lifecycle
│
└── tests/
    ├── remote/
    │   ├── crypto.test.ts
    │   ├── frames.test.ts
    │   ├── pairing.test.ts
    │   ├── bridge.test.ts
    │   ├── trust-store.test.ts
    │   └── session-keys.test.ts
    └── relay/
        ├── server.test.ts
        ├── auth.test.ts
        ├── sessions.test.ts
        └── rate-limit.test.ts
```

---

## 2. Interfaces TypeScript

### 2.1 Frame Types (Discriminated Union)

```typescript
// packages/remote-control/src/types.ts

// ─── Base ────────────────────────────────────────────────────────────────────

export interface BaseFrame {
  seq_id: number         // Monotonically increasing per sender per session
  timestamp: number      // Unix ms
  nonce: string          // 24 bytes base64 — unique per frame, replay protection
}

// ─── Data Frames ─────────────────────────────────────────────────────────────

export interface PromptFrame extends BaseFrame {
  type: 'prompt'
  content: string
  attachments?: string[] // file paths or base64 (future)
}

export interface ResponseDeltaFrame extends BaseFrame {
  type: 'response_delta'
  delta: string
  done: boolean
  reasoning?: string     // deepseek-reasoner reasoning_content
}

export interface ToolCallFrame extends BaseFrame {
  type: 'tool_call'
  tool_id: string
  name: string
  args: Record<string, unknown>
  status: 'pending' | 'running' | 'completed' | 'failed'
  result?: string
  requires_approval: boolean
}

export interface ToolApprovalFrame extends BaseFrame {
  type: 'tool_approval'
  tool_id: string
  approved: boolean
}

export interface FileDiffFrame extends BaseFrame {
  type: 'file_diff'
  path: string
  diff: string           // unified diff
  action: 'create' | 'edit' | 'delete'
}

export interface TerminalOutputFrame extends BaseFrame {
  type: 'terminal_output'
  output: string
  exit_code?: number
}

export interface ResizeFrame extends BaseFrame {
  type: 'resize'
  cols: number
  rows: number
}

// ─── Control Frames ──────────────────────────────────────────────────────────

export interface HeartbeatFrame extends BaseFrame {
  type: 'heartbeat'
}

export interface PairingHelloFrame extends BaseFrame {
  type: 'pairing_hello'
  device_id: string
  device_name: string
  public_key: string     // Curve25519 base64
}

export interface PairingAckFrame extends BaseFrame {
  type: 'pairing_ack'
  accepted: boolean
  cli_public_key: string // Curve25519 base64
  confirmation_code: string // 6-digit derived code
}

export interface PairingConfirmFrame extends BaseFrame {
  type: 'pairing_confirm'
  confirmation_code: string
}

export interface SessionStartFrame extends BaseFrame {
  type: 'session_start'
  session_id: string
  device_id: string
}

export interface SessionEndFrame extends BaseFrame {
  type: 'session_end'
  reason: 'user' | 'timeout' | 'error' | 'unpaired'
}

// ─── Union ───────────────────────────────────────────────────────────────────

export type Frame =
  | PromptFrame
  | ResponseDeltaFrame
  | ToolCallFrame
  | ToolApprovalFrame
  | FileDiffFrame
  | TerminalOutputFrame
  | ResizeFrame
  | HeartbeatFrame
  | PairingHelloFrame
  | PairingAckFrame
  | PairingConfirmFrame
  | SessionStartFrame
  | SessionEndFrame
```

### 2.2 Encrypted Wire Format + Handshake

```typescript
// packages/remote-control/src/types.ts (continuação)

// ─── Encrypted Envelope (wire format) ────────────────────────────────────────

export interface EncryptedEnvelope {
  nonce: string          // 24 bytes base64
  ciphertext: string     // XSalsa20-Poly1305(JSON.stringify(Frame)), base64
  sender_id: string      // 'cli' | device_id
}

// ─── Handshake (Noise NK-like, ephemeral session keys) ───────────────────────

export interface HandshakeInit {
  type: 'handshake_init'
  device_id: string
  ephemeral_public: string   // Curve25519 base64 (per-session)
  signature: string          // sign(ephemeral_public, long_term_secret_key), base64
}

export interface HandshakeResponse {
  type: 'handshake_response'
  ephemeral_public: string   // CLI ephemeral public, base64
  signature: string          // sign(ephemeral_public, cli_long_term_secret_key), base64
}

export type HandshakeMessage = HandshakeInit | HandshakeResponse
```

### 2.3 Device Trust Store

```typescript
// src/remote/trust-store.ts

export interface TrustedDevice {
  device_id: string          // UUID v4
  device_name: string        // "iPhone do Marcelo"
  public_key: string         // Curve25519 long-term, base64
  paired_at: string          // ISO 8601
  last_seen: string          // ISO 8601
}

export interface DeviceTrustStore {
  list(): TrustedDevice[]
  get(device_id: string): TrustedDevice | undefined
  add(device: TrustedDevice): Promise<void>
  remove(device_id: string): Promise<void>
  isKnown(device_id: string): boolean
  updateLastSeen(device_id: string): Promise<void>
}

// Persisted at ~/.deepseek/devices.json (chmod 600)
// Format:
// {
//   "devices": TrustedDevice[]
// }
```

### 2.4 Session Interface

```typescript
// packages/remote-control/src/types.ts (continuação)

export interface RemoteSession {
  session_id: string
  device_id: string
  started_at: number         // Unix ms
  last_activity: number      // Unix ms
  shared_secret: Uint8Array  // derived from ephemeral DH (in-memory only)
  local_seq: number          // next seq_id for outbound frames
  remote_seq: number         // last received seq_id
  status: 'handshaking' | 'active' | 'reconnecting' | 'closed'
}
```

### 2.5 Relay Config

```typescript
// packages/relay-server/src/config.ts

export interface RelayConfig {
  port: number                       // Default: 8787
  host: string                       // Default: '0.0.0.0'
  db_path: string                    // SQLite path (MVP)
  session: {
    timeout_ms: number               // 600_000 (10 min)
    heartbeat_interval_ms: number    // 30_000
    buffer_size: number              // 500 frames
    pairing_window_ms: number        // 300_000 (5 min)
    max_frame_bytes: number          // 65_536 (64KB)
  }
  rate_limit: {
    frames_per_second: number        // 30 per session
    connections_per_device: number   // 3
    sessions_create_per_min: number  // 5 per IP
    max_active_sessions: number      // 10 per device
  }
}
```

### 2.6 QR Payload

```typescript
// packages/remote-control/src/types.ts (continuação)

export interface PairingPayload {
  v: number              // protocol version (1)
  r: string              // relay WebSocket URL (wss://...)
  s: string              // session_id
  k: string              // CLI long-term public key, base64
}

// QR encodes: JSON.stringify(PairingPayload)
// Scheme alternative for deep linking: dsc://pair?v=1&r=...&s=...&k=...
```

---

## 3. Fluxo de Pareamento (First-Time)

```
┌─────────┐                    ┌─────────┐                    ┌──────────┐
│   CLI   │                    │  RELAY  │                    │  MOBILE  │
└────┬────┘                    └────┬────┘                    └────┬─────┘
     │                              │                              │
     │ 1. Gera device keypair       │                              │
     │    (se ~/.deepseek/device.key│                              │
     │     não existir)             │                              │
     │    chmod 600                 │                              │
     │                              │                              │
     │ 2. POST /api/v1/sessions ───►│                              │
     │    { cli_device_id,          │                              │
     │      public_key }            │                              │
     │◄── { session_id,            │                              │
     │      expires_at } ──────────│                              │
     │                              │                              │
     │ 3. WS connect ─────────────►│                              │
     │    /ws?session_id=X          │                              │
     │       &role=cli              │                              │
     │       &device_id=Y           │                              │
     │                              │                              │
     │ 4. Renderiza QR no terminal  │                              │
     │    Payload JSON:             │                              │
     │    { v:1, r: relay_ws_url,   │                              │
     │      s: session_id,          │                              │
     │      k: cli_public_key }     │                              │
     │                              │                              │
     │                              │  5. Mobile escaneia QR       │
     │                              │     extrai payload           │
     │                              │◄── WS connect ──────────────│
     │                              │    /ws?session_id=X          │
     │                              │       &role=mobile           │
     │                              │       &device_id=Z           │
     │                              │                              │
     │                              │  6. pairing_hello            │
     │◄─────── relay forward ──────│◄─────────────────────────────│
     │    { type: 'pairing_hello',  │                              │
     │      device_id: Z,           │                              │
     │      device_name: "iPhone",  │                              │
     │      public_key: mob_pub }   │                              │
     │                              │                              │
     │ 7. CLI deriva shared secret: │                              │
     │    X25519(cli_priv, mob_pub) │                              │
     │                              │                              │
     │ 8. CLI gera código 6 dígitos:│                              │
     │    HMAC-SHA256(              │                              │
     │      cli_pub || mob_pub,     │                              │
     │      session_id             │                              │
     │    )[0..3] → decimal 6-dig  │                              │
     │                              │                              │
     │ 9. CLI exibe no terminal:    │                              │
     │    ┌─────────────────────┐   │                              │
     │    │ Dispositivo: iPhone │   │                              │
     │    │ Código: 847291      │   │                              │
     │    │ Confirme no celular │   │                              │
     │    └─────────────────────┘   │                              │
     │                              │                              │
     │ 10. pairing_ack ───────────►│──────────────────────────────►│
     │    { accepted: true,         │                              │
     │      cli_public_key,         │                              │
     │      confirmation_code }     │                              │
     │                              │                              │
     │                              │  11. Mobile computa mesmo    │
     │                              │      código com mesma fórmula│
     │                              │      Exibe: "Código: 847291" │
     │                              │      e pede tap pra confirmar│
     │                              │                              │
     │                              │  12. pairing_confirm         │
     │◄─────── relay forward ──────│◄─────────────────────────────│
     │    { confirmation_code }     │                              │
     │                              │                              │
     │ 13. CLI valida que código    │                              │
     │     recebido == calculado    │                              │
     │                              │                              │
     │ 14. CLI persiste device:     │                              │
     │     ~/.deepseek/devices.json │  14. Mobile persiste em     │
     │     { device_id, name,       │      SecureStore             │
     │       public_key, paired_at }│                              │
     │                              │                              │
     │ 15. session_start ──────────►│──────────────────────────────►│
     │                              │                              │
     │ ═══ PAREAMENTO COMPLETO ═══  │                              │
```

**Derivação do código de 6 dígitos:**
```typescript
const material = concat(cli_public_key, mobile_public_key)
const hmac = HMAC_SHA256(material, encode(session_id))
const code = (readUint32BE(hmac, 0) % 1_000_000).toString().padStart(6, '0')
```
Ambos os lados computam o mesmo código — se um MITM substituir uma chave, os códigos divergem.

**Paths e permissões:**
- `~/.deepseek/device.key` — 32-byte NaCl seed (gera keypair deterministicamente), chmod 600
- `~/.deepseek/devices.json` — `{ devices: TrustedDevice[] }`, chmod 600

**Pairing window:** 5 minutos. Se expirar, session é destruída e precisa recomeçar.

---

## 4. Fluxo de Sessão Normal (Pós-Pareamento)

```
┌─────────┐                    ┌─────────┐                    ┌──────────┐
│   CLI   │                    │  RELAY  │                    │  MOBILE  │
└────┬────┘                    └────┬────┘                    └────┬─────┘
     │                              │                              │
     │                              │  1. Mobile conecta ao relay  │
     │                              │◄── WS + device_id header ───│
     │                              │                              │
     │                              │  2. Challenge-response:      │
     │                              │──── { challenge: random } ──►│
     │                              │◄── { sig: sign(challenge,   │
     │                              │          device_priv) } ─────│
     │                              │     verify(sig, stored_pub)  │
     │                              │                              │
     │  3. Relay notifica CLI       │                              │
     │◄── relay_event:             │                              │
     │    { peer_connected,         │                              │
     │      device_id, name }       │                              │
     │                              │                              │
     │  4. Ephemeral key exchange   │                              │
     │     (forward secrecy)        │                              │
     │                              │                              │
     │◄─────── handshake_init ─────│◄─────────────────────────────│
     │  { device_id,                │  { device_id,                │
     │    ephemeral_public,         │    ephemeral_public,         │
     │    signature(eph, lt_priv) } │    signature }               │
     │                              │                              │
     │  CLI verifica signature      │                              │
     │  com stored mobile pub key   │                              │
     │                              │                              │
     │── handshake_response ───────►│──────────────────────────────►│
     │  { ephemeral_public,         │                              │
     │    signature(eph, cli_priv) }│                              │
     │                              │                              │
     │  5. Ambos derivam session    │  5. Mobile verifica sig CLI  │
     │     key:                     │     e deriva session key:    │
     │     X25519(cli_eph_priv,     │     X25519(mob_eph_priv,    │
     │            mob_eph_pub)      │            cli_eph_pub)      │
     │                              │                              │
     │  6. session_start (E2E)      │                              │
     │◄════════════════════════════►│◄═════════════════════════════►│
     │                              │                              │
     │  ═══ SESSÃO ATIVA (E2E) ═══ │                              │
     │                              │                              │
     │  7. Mobile envia prompt      │                              │
     │◄═══ EncryptedEnvelope ══════│◄═════════════════════════════│
     │     decrypt → PromptFrame    │                              │
     │                              │                              │
     │  8. CLI injeta no agent loop │                              │
     │     (mesmo pipeline de stdin)│                              │
     │                              │                              │
     │  9. Agent produz output      │                              │
     │═══ ResponseDeltaFrame ══════►│══════════════════════════════►│
     │═══ ToolCallFrame ═══════════►│══════════════════════════════►│
     │═══ FileDiffFrame ═══════════►│══════════════════════════════►│
     │═══ TerminalOutputFrame ═════►│══════════════════════════════►│
     │                              │                              │
     │  10. Tool precisa approval   │                              │
     │═══ ToolCallFrame            ►│══════════════════════════════►│
     │    { requires_approval: true}│                              │
     │                              │                              │
     │◄═══ ToolApprovalFrame ══════│◄═════════════════════════════│
     │    { approved: true/false }  │                              │
     │                              │                              │
     │  11. Heartbeat (30s)         │                              │
     │◄════════════════════════════►│◄═════════════════════════════►│
```

**Relay zero-knowledge:** O relay vê apenas `EncryptedEnvelope` — session_id, tamanho e timestamps. Nunca o conteúdo.

**Integração com agent loop:** O bridge registra-se como input source alternativo. Quando recebe `PromptFrame`, injeta no mesmo caminho que `processUserInput()` em `src/agent/agent.ts`. Os frames de output são emitidos via callbacks no streaming loop existente.

---

## 5. Fluxo de Reconexão

```
Mobile desconecta (rede instável, app vai pra background)
     │
     ├── Relay detecta WS closed
     │   └── Mantém session buffer (últimos 500 frames por seq_id)
     │   └── Inicia timer de 10min
     │   └── Notifica CLI: relay_event { peer_disconnected }
     │
     ├── CLI continua operando normalmente
     │   └── Bufferiza frames outbound (até 500)
     │
     ▼
Mobile reconecta (< 10min):
     │
     ├── WS connect + device_id + session_id
     ├── Challenge-response (long-term key)
     ├── Mobile envia: { type: 'reconnect', last_seq_id: N }
     │
     ├── Relay notifica CLI: relay_event { peer_connected }
     │
     ├── CLI recebe reconnect frame
     │   └── Replay frames com seq_id > N (do buffer local)
     │   └── Mesma ephemeral session key (não re-negocia)
     │   └── Continua normalmente
     │
     └── Mobile recebe frames perdidos em ordem

─────────────────────────────────────────────────────────

Mobile reconecta (> 10min):
     │
     ├── Relay já descartou session + buffer
     ├── Mobile tenta conectar com session_id antigo
     │   └── Relay responde: relay_event { session_expired }
     │
     ├── CLI já recebeu: session_end { reason: 'timeout' }
     │   └── Limpou ephemeral keys da memória
     │
     └── Mobile inicia NOVA sessão:
         └── Handshake fresh (passo 4 do fluxo normal)
         └── SEM QR — device já é trusted, usa long-term key
         └── Novo session_id, novas ephemeral keys
```

**Buffer de reconexão:**
- CLI mantém ring buffer de 500 frames outbound em memória
- Indexado por seq_id
- Na reconexão, replay é `frames.filter(f => f.seq_id > last_seq_id)`
- Se o buffer for ultrapassado (mobile ficou offline muito tempo mas < 10min), CLI envia um `session_end { reason: 'error' }` e força nova sessão

---

## 6. Contratos CLI ↔ Relay ↔ Mobile

### 6.1 REST Endpoints (Relay)

```
POST   /api/v1/sessions
       Headers: X-Device-Id, X-Timestamp, X-Signature
       Body: { cli_device_id: string, public_key: string }
       Response 201: { session_id: string, expires_at: string }
       Errors: 429 (rate limited), 400 (bad request)

GET    /api/v1/sessions/:session_id/status
       Headers: X-Device-Id, X-Timestamp, X-Signature
       Response 200: { status: 'waiting'|'paired'|'active'|'expired', peers: string[] }
       Errors: 404 (not found), 403 (not your session)

DELETE /api/v1/sessions/:session_id
       Headers: X-Device-Id, X-Timestamp, X-Signature
       Response 204
       Side effect: notifica peers via WS relay_event { session_expired }

GET    /api/v1/health
       Response 200: { ok: true, version: string, uptime_s: number, active_sessions: number }
```

### 6.2 WebSocket Upgrade

```
GET /ws?session_id=X&role=cli|mobile&device_id=Y
    Headers:
      X-Device-Id: <device_id>
      X-Timestamp: <unix_ms>
      X-Signature: base64(Ed25519_sign(
        utf8("GET/ws" + session_id + timestamp),
        device_secret_key
      ))

    Upgrade: websocket
    Connection: Upgrade
```

O relay valida a signature contra a public key registrada na session (para CLI) ou contra o trust store do relay (para mobile reconectando).

Na primeira conexão mobile (pairing), o relay aceita sem signature — a autenticação é feita pelo fluxo de pareamento E2E.

### 6.3 WebSocket Messages

**Após handshake E2E, toda mensagem é EncryptedEnvelope:**

```typescript
// JSON over WebSocket text frame
{
  "nonce": "base64_24_bytes",
  "ciphertext": "base64_xsalsa20poly1305(JSON.stringify(Frame))",
  "sender_id": "cli" | "<device_id>"
}
```

**Mensagens de controle do relay (plaintext, relay → peer):**

```typescript
// Não E2E — metadata do relay
{ "relay_event": "peer_connected", "device_id": string, "device_name": string }
{ "relay_event": "peer_disconnected", "device_id": string }
{ "relay_event": "session_expired" }
{ "relay_event": "challenge", "challenge": "base64_32_bytes" }
{ "relay_event": "challenge_ok" }
{ "relay_event": "challenge_failed", "reason": string }
{ "relay_event": "error", "code": string, "message": string }
{ "relay_event": "rate_limited", "retry_after_ms": number }
```

### 6.4 Auth Headers (HTTP requests)

```
X-Device-Id: <device_id>
X-Timestamp: <unix_ms>
X-Signature: base64(Ed25519_sign(
  utf8(method + path + timestamp + SHA256(body)),
  device_secret_key
))
```

Relay valida:
1. Timestamp drift < 60s
2. Signature válida contra public key conhecida
3. Nonce (timestamp) não reutilizado (cache de 120s)

---

## 7. Segurança

### 7.1 Key Storage

| Artefato | Path | Permissions | Conteúdo |
|----------|------|-------------|----------|
| CLI device keypair | `~/.deepseek/device.key` | 0600 | 32-byte NaCl seed (JSON: `{ seed: "base64" }`) |
| Trusted devices | `~/.deepseek/devices.json` | 0600 | `{ devices: TrustedDevice[] }` |
| Ephemeral session keys | Memória apenas | — | Descartadas no session_end |
| Mobile device key | SecureStore (iOS Keychain / Android Keystore) | OS-managed | NaCl seed |
| Mobile trusted CLI | SecureStore | OS-managed | `{ cli_public_key, relay_url }` |

**Geração da keypair CLI:**
```typescript
import nacl from 'tweetnacl'
const seed = nacl.randomBytes(32)  // persiste este seed
const keyPair = nacl.box.keyPair.fromSecretKey(seed)
// keyPair.publicKey = Curve25519 public (32 bytes)
// keyPair.secretKey = Curve25519 secret (32 bytes)
```

**Startup check:** Se `device.key` existir mas tiver permissions != 0600, a CLI recusa operar e exibe warning.

### 7.2 Rate Limiting (Relay)

| Recurso | Limite | Janela | Ação |
|---------|--------|--------|------|
| POST /api/v1/sessions | 5 | 1 min/IP | 429 + retry_after |
| WS connections | 3 | por device_id simultâneas | Reject oldest |
| Frames/segundo | 30 | por session (token bucket) | relay_event: rate_limited |
| Tamanho de frame | 64 KB | por mensagem | WS close 1009 |
| Sessions ativas | 10 | por cli_device_id | 429 |
| Pairing window | — | 5 min desde criação | Session auto-destroy |

### 7.3 Anti-Hijack (Confirmação de 6 dígitos)

**Objetivo:** Garantir que o mobile que escaneou o QR está fisicamente próximo do CLI (anti-MITM).

**Mecânica:**
1. Ambos os lados possuem a chave pública do outro (CLI via QR → mobile; mobile via pairing_hello → CLI)
2. Ambos computam independentemente:
   ```
   code = HMAC-SHA256(cli_pub || mobile_pub, utf8(session_id))[0..3] → uint32 % 1_000_000 → padStart(6, '0')
   ```
3. CLI exibe o código no terminal
4. Mobile exibe o mesmo código e pede confirmação do usuário
5. Se um MITM substituiu uma chave pública, os códigos serão diferentes
6. Confirmação é criptográfica: mobile envia `pairing_confirm` com o código — CLI valida

**Se código não bater:**
- CLI envia `pairing_ack { accepted: false }`
- Session é destruída imediatamente
- Evento logado no audit log

### 7.4 Replay Protection

1. **Nonce único:** Cada `EncryptedEnvelope` tem nonce de 24 bytes aleatórios. XSalsa20-Poly1305 garante que mesmo plaintext idêntico produz ciphertext diferente.
2. **seq_id monotônico:** Cada sender mantém counter incremental. Receptor rejeita seq_id <= último aceito.
3. **Timestamp check:** Frames com `timestamp` drift > 60s são descartados pelo receptor.
4. **HTTP nonce:** `X-Timestamp` no header é verificado contra cache de 120s no relay — replays de requests HTTP são rejeitados.

### 7.5 Forward Secrecy

- Ephemeral keypair (Curve25519) gerado por sessão — nunca persistido
- Shared secret derivado via X25519(local_ephemeral_priv, remote_ephemeral_pub)
- Comprometimento da long-term key NÃO expõe sessões anteriores
- Comprometimento de uma session key NÃO expõe outras sessões

### 7.6 Relay Zero-Knowledge

O relay vê apenas:
- `session_id` (para routing)
- Tamanho do `ciphertext` (para rate limiting)
- Timestamps de conexão/desconexão
- `device_id` e `sender_id` (para routing)

O relay NÃO vê:
- Conteúdo dos prompts
- Respostas do agent
- File diffs
- Terminal output
- Nenhum dado do usuário

### 7.7 Threat Model

| Ameaça | Vetor | Mitigação |
|--------|-------|-----------|
| MITM no pairing | Substitui public key no QR | Código de 6 dígitos diverge |
| Relay comprometido | Lê mensagens | E2E encryption — relay é cego |
| Relay comprometido | Correlaciona metadata | Sessions curtas + device_ids opacos |
| Device key roubada | Impersona mobile | CLI mostra notificação de nova sessão |
| Shoulder surfing QR | Attacker escaneia | Código de 6 dígitos + window de 5min |
| Replay de frames | Re-envia frames capturados | Nonce + seq_id + timestamp |
| DoS no relay | Flood de conexões | Rate limiting + token bucket |
| Mobile rooted | Extrai keys do SecureStore | Fora do threat model (dispositivo comprometido) |

---

## 8. CommandResult Type

Adicionar ao `src/commands/types.ts`:

```typescript
  | { type: 'remote-control'; action: 'start' }
  | { type: 'remote-control'; action: 'status' }
  | { type: 'remote-control'; action: 'stop' }
  | { type: 'remote-control'; action: 'unpair'; deviceId?: string }
  | { type: 'remote-control'; action: 'devices' }
```

### Command Parser (`src/commands/rc/index.ts`)

```typescript
import type { Command } from '../types.js'

const command: Command = {
  name: 'remote-control',
  aliases: ['rc'],
  description: 'Control DeepSeek Code from your phone',
  parse(args) {
    const sub = args[0]
    if (!sub || sub === 'start') return { type: 'remote-control', action: 'start' }
    if (sub === 'status') return { type: 'remote-control', action: 'status' }
    if (sub === 'stop') return { type: 'remote-control', action: 'stop' }
    if (sub === 'devices') return { type: 'remote-control', action: 'devices' }
    if (sub === 'unpair') return { type: 'remote-control', action: 'unpair', deviceId: args[1] }
    return { type: 'unknown', input: 'Usage: /rc [start|status|stop|devices|unpair [device_id]]' }
  },
}

export default command
```

### Subcommands Behavior

| Subcommand | Comportamento |
|------------|---------------|
| `/rc` ou `/rc start` | Se não pareado → gera QR. Se pareado → conecta ao relay e aguarda mobile |
| `/rc status` | Mostra: conexão ativa? qual device? latência? último heartbeat? |
| `/rc stop` | Desconecta session ativa (não remove trust) |
| `/rc devices` | Lista devices pareados com last_seen |
| `/rc unpair [id]` | Remove device do trust store. Sem id → lista pra escolher |

---

## 9. Bridge — Integração com Agent Loop

### Interface do Bridge (`src/remote/bridge.ts`)

```typescript
export interface RemoteBridge {
  // Lifecycle
  start(): Promise<void>
  stop(): Promise<void>
  isActive(): boolean

  // Estado
  getSession(): RemoteSession | null
  getConnectedDevice(): TrustedDevice | null

  // Input: mobile → agent
  onRemotePrompt(handler: (content: string) => void): void

  // Output: agent → mobile (chamados pelo agent loop)
  emitResponseDelta(delta: string, done: boolean): void
  emitToolCall(call: { tool_id: string; name: string; args: Record<string, unknown>; status: string; requires_approval: boolean; result?: string }): void
  emitFileDiff(diff: { path: string; diff: string; action: 'create' | 'edit' | 'delete' }): void
  emitTerminalOutput(output: string, exitCode?: number): void

  // Approval: mobile decide
  requestToolApproval(toolId: string, name: string, args: Record<string, unknown>): Promise<boolean>
}
```

### Pontos de integração no `src/agent/agent.ts`

O bridge se conecta em 3 pontos existentes:

1. **Input:** Registra callback via `onRemotePrompt` — quando mobile envia prompt, o bridge chama o mesmo handler que processa input do stdin (a função que hoje recebe user message e inicia o agent loop turn).

2. **Output streaming:** No loop de streaming (onde hoje acumula `delta` e renderiza na TUI), adiciona chamada a `bridge.emitResponseDelta(delta, done)`.

3. **Tool execution:** Antes de executar uma tool que precisa de approval (onde hoje chama `setShellConfirmHandler`), se bridge estiver ativo e mobile conectado, chama `bridge.requestToolApproval()` em vez de (ou além de) pedir confirmação no terminal local.

### Prioridade de input

Quando bridge está ativo e mobile conectado:
- Prompts do mobile são processados normalmente
- Input local do terminal continua funcionando em paralelo
- Não há conflito — ambos alimentam a mesma fila de mensagens
- Se ambos enviarem ao mesmo tempo, first-come-first-served (sequential no agent loop)

---

## 10. Decisões Arquiteturais

| Decisão | Justificativa | Alternativa descartada |
|---------|---------------|----------------------|
| Package name `remote-control` (não `remote-shared`) | Mais descritivo, alinha com o nome da feature | `remote-shared` — genérico demais |
| TweetNaCl (`tweetnacl`) | Zero deps, auditado, 7KB, roda em Bun e RN | libsodium-wrappers — 200KB+, FFI issues em RN |
| SQLite via `bun:sqlite` (relay MVP) | Zero infra, built-in no Bun, suficiente para milhares de sessions | Redis Streams — adiciona infra, necessário apenas em scale |
| QR payload como JSON | Simples, debugável, extensível com campo `v` | URI scheme (`dsc://`) — parsing mais complexo no mobile |
| Relay como Bun.serve puro | Mesma stack, WebSocket nativo, zero deps | Fastify/Express — overhead desnecessário, Bun.serve é mais rápido |
| Confirmação de 6 dígitos (HMAC) | Anti-MITM, UX familiar (Bluetooth/Signal), sem canal secundário | SAS wordlist (Signal) — mais complexo, menos familiar |
| Buffer de reconexão na CLI (não no relay) | Relay é stateless quanto a conteúdo, CLI já tem os frames | Redis buffer no relay — relay veria frames encrypted inutilmente |
| Ed25519 para auth headers (não HMAC com shared secret) | Relay não precisa shared secret com cada client | HMAC — exigiria key exchange CLI↔relay |
| Ephemeral keys por sessão (Noise NK) | Forward secrecy sem complexidade de double ratchet | Double ratchet (Signal) — overkill pra sessions curtas |
| Sem AgentStatusFrame separado | Status pode ser inferido dos frames existentes (ToolCallFrame com status, ResponseDeltaFrame com done) | Frame dedicado — overhead desnecessário |

---

## 11. Riscos e Mitigações

| Risco | Impacto | Probabilidade | Mitigação |
|-------|---------|---------------|-----------|
| Relay single point of failure | Mobile não conecta | Média | Self-hostable + fallback message no CLI |
| Device key leaked | Attacker impersona mobile | Baixa | Notificação na CLI + `/rc unpair` + rate limit |
| QR shoulder-surfed | Pairing hijack | Baixa | Código 6 dígitos + window 5min |
| Large diffs excedem 64KB | Frame rejeitado | Média | Chunking de FileDiffFrame (split em múltiplos frames) |
| Mobile em background (iOS) | WS desconecta | Alta | Reconexão automática + buffer 500 frames |
| Bun WebSocket bugs | Conexão instável | Baixa | Heartbeat 30s + reconnect automático |
| Agent loop bloqueado | Mobile não recebe output | Baixa | Frames emitidos async (não bloqueiam loop) |

---

## 12. Dependências

### CLI (`deepseek-code` — root package.json)
```json
{
  "tweetnacl": "^1.0.3",
  "tweetnacl-util": "^0.15.1",
  "qrcode-terminal": "^0.12.0"
}
```

### packages/remote-control
```json
{
  "tweetnacl": "^1.0.3",
  "tweetnacl-util": "^0.15.1"
}
```

### packages/relay-server
```json
{
  "tweetnacl": "^1.0.3",
  "tweetnacl-util": "^0.15.1"
}
```
(Bun built-in: `bun:sqlite`, HTTP server, WebSocket — zero deps extras)

### packages/mobile-app (futuro)
```json
{
  "tweetnacl": "^1.0.3",
  "react-native-get-random-values": "^1.11.0",
  "expo-camera": "latest",
  "expo-secure-store": "latest"
}
```

---

## 13. Ordem de Implementação

### Fase 1: Foundation
1. `packages/remote-control/src/types.ts` — Todas as interfaces
2. `packages/remote-control/src/crypto.ts` — Wrappers tweetnacl (keygen, encrypt, decrypt, sign, verify, derive)
3. `packages/remote-control/src/frames.ts` — Encode/decode/validate + seq_id management
4. `src/commands/rc/index.ts` — Command parser
5. `src/remote/trust-store.ts` — Device persistence
6. `src/remote/crypto.ts` — CLI key management (device.key)
7. Tests RED para tudo acima

### Fase 2: Relay Server
1. `packages/relay-server/src/config.ts` — Config loading
2. `packages/relay-server/src/store.ts` — SQLite sessions/devices
3. `packages/relay-server/src/auth.ts` — Challenge-response + header validation
4. `packages/relay-server/src/rate-limit.ts` — Token bucket
5. `packages/relay-server/src/sessions.ts` — Session lifecycle
6. `packages/relay-server/src/server.ts` — Bun.serve HTTP+WS
7. Tests

### Fase 3: CLI Integration
1. `src/remote/qr.ts` — QR rendering no terminal
2. `src/remote/pairing.ts` — Full pairing flow (orquestra QR → WS → handshake)
3. `src/remote/session-keys.ts` — Ephemeral derivation
4. `src/remote/bridge.ts` — WS client + frame dispatch
5. Integração com `src/agent/agent.ts` (3 pontos de integração)
6. Handler de CommandResult `remote-control` no agent
7. Tests E2E: CLI ↔ relay ↔ mock mobile

### Fase 4: Mobile App (posterior)
1. React Native / Expo scaffold
2. QR scanner + deep link handler
3. Crypto layer (tweetnacl + SecureStore)
4. Pairing flow UI
5. Chat UI + streaming
6. Diff viewer
7. Tool approval UI
8. Push notifications para background reconexão
