# GPT Direct Connection — v0.3.15

## Desired daily UX

The normal workflow is conversational:

1. user asks the stock GPT a normal market/strategy question;
2. GPT reads the latest Eason Trading state through an Action/tool;
3. GPT analyzes/researches;
4. if the answer changes actionable strategy, GPT writes the strategy update automatically unless the user explicitly says not to update the App;
5. Cloud queues the strategy-only command;
6. local Backend validates it through the same `EASON_TRADING_UPDATE_V1` safety path, applies it and refreshes the App.

No clipboard step is required during the Direct path.

## Architecture

```text
ChatGPT existing custom GPT / future MCP app
        |
        | Bearer-authenticated Action or MCP
        v
Cloudflare Worker
  - read-only GPT state replica
  - strategy-only command queue
        |
        | x-api-key (local Backend only)
        v
Eason Trading Backend
  - 15s command reconcile
  - existing GPT-update validator
  - strategy-only apply/undo
        |
        v
Radar / Setup / Playbook / Trigger
```

If the PC is offline, commands remain `PENDING` and are applied when the Backend is online again.

## Immediate Plus path: existing custom GPT + Actions

Current personal Plus accounts cannot attach a private write-capable MCP to an ordinary conversation. If the user already owns an editable custom stock GPT, Actions remain the practical direct-write path.

One-time setup after Cloudflare deployment:

```powershell
powershell -ExecutionPolicy Bypass -File ".\scripts\setup-gpt-action.ps1"
```

The helper outputs:

- Action schema URL: `https://<worker>/gpt-action-openapi.json`
- Authentication: API Key -> Bearer
- private bearer token from local `.env.local`
- privacy URL: `https://<worker>/privacy`
- GPT instruction rules: `https://<worker>/gpt-action-instructions.txt`
- whether the saved stock chat URL looks like an existing custom GPT or an ordinary chat.

It also writes the same details to local `runtime/gpt-action-setup.txt`. This runtime file contains a private token and must never be included in a source/release ZIP.

## Action operations

### Read

- `checkEasonTradingConnection`
- `getTradingState`
- `getStockStrategy`
- `getStrategyCommandStatus`

### Strategy write

- `updateTradingStrategy`
- `undoLastStrategyUpdate`

The normal write request uses `waitForApplySeconds=16`. When the local Backend is online, the Action can usually return `applied: true` in the same turn. If not, it returns a pending command that will reconcile later.

## GPT behavior contract

The stock GPT instructions should state:

- read current App state before material strategy analysis;
- automatically write back any changed actionable strategy unless the user says not to update;
- never encode a real trade, cash change or position quantity change as a strategy update;
- say **updated** only when the Action returns `applied: true`;
- if `PENDING`, say the change is queued and will apply when the local Backend is online;
- do not ask the user to copy `EASON_TRADING_UPDATE_V1` while Direct Actions are available.

The deployed Worker exposes these rules at `/gpt-action-instructions.txt`.

## Hard safety boundary

The GPT-facing remote surface has no operation for:

- recording BUY/SELL executions;
- editing cash;
- editing held quantity;
- initializing/correcting the authoritative Ledger.

The read replica intentionally omits cash and executed-trade history. Held position context is mirrored only for strategy reasoning.

## Remote MCP

`POST https://<worker>/mcp` remains available with the same strategy-only tools and bearer token. It is retained for supported write-capable MCP/Apps surfaces. Do not assume a personal Plus normal conversation can attach it.

## Fallback

The old clipboard bridge remains available as a recovery/fallback path. Once Direct Action is verified on the user's actual stock GPT, it should not be part of normal daily use.

### First Cloudflare account: workers.dev onboarding

A brand-new Cloudflare Workers account may require a one-time `workers.dev` account subdomain registration before the first Worker can publish. The setup helper detects Wrangler's onboarding error, opens the exact Cloudflare onboarding URL, waits for the registration to finish, then retries the same bootstrap deploy. This does **not** use or configure GitHub. The setup writes a non-secret local resume checkpoint so an interruption after D1 migrations does not recreate the database or repeat an unchanged migration set.
