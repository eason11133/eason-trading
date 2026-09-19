# GPT Direct Connection — v0.3.18 FINAL-R3

## Daily workflow

1. GPT reads the latest Eason Trading state through the authenticated Action.
2. GPT performs strategy analysis using that context.
3. If actionable strategy changes, GPT sends a strategy-only command unless the user asked for analysis only.
4. Cloud stores the command as `PENDING`.
5. The local backend polls, validates, and applies it through the existing update path.
6. Cloud reports `APPLIED` or `FAILED`; the app refreshes from local truth.

If the PC is offline, the command remains `PENDING` and reconciles when the backend returns. No clipboard step is required in the normal Direct path.

## Architecture

```text
Custom GPT / compatible MCP client
        | Bearer-authenticated strategy surface
        v
Cloudflare Worker + D1
  - limited read replica
  - strategy-only command queue
        | x-api-key backend surface
        v
Local Eason Trading backend
  - 15-second command reconciliation
  - schema and authority validation
  - authoritative strategy apply/undo
        v
Mobile app / local state
```

## One-time Action setup

After deploying the Worker, run:

```powershell
powershell -ExecutionPolicy Bypass -File ".\scripts\setup-gpt-action.ps1"
```

The helper identifies the schema URL, privacy URL, authentication mode, and instruction URL. It may also create a local runtime setup note containing a private bearer token. That file, `.env.local`, and the token itself must never be committed or copied into documentation.

## Current Action surface

The OpenAPI surface includes a lightweight connection/readiness operation plus these strategy tools:

### Read and event context

- `getTradingState`
- `getStockStrategy`
- `getActiveHandoffContext`
- `getLatestReviewEvent`
- `getCloseReviewPackage`
- `getStrategyCommandStatus`

### Strategy commands

- `updateTradingStrategy`
- `undoLastStrategyUpdate`

`checkEasonTradingConnection` is the readiness operation. A normal write can request a bounded wait for local apply; only an `applied: true` response means the change is complete. Otherwise the command remains queued and its status can be queried later.

## Behavior contract

- Read current app state before material strategy analysis.
- Write back a changed actionable strategy unless the user explicitly requests analysis only.
- Never encode cash, an executed BUY/SELL, or a holding-quantity change as strategy.
- Say **updated** only when the command reports `APPLIED`/`applied: true`.
- Describe `PENDING` as queued, not completed.
- Keep exact event correlation when reassessing a pushed review event.

## Hard safety boundary

The GPT-facing surface has no operation for recording a trade, editing cash, changing held quantity, or correcting the Ledger. The read replica omits cash amounts and executed-trade history. Position context, when supplied for reasoning, is explicitly non-authoritative. Cloud and local validation both reject Ledger-shaped strategy payloads.

`POST /mcp` exposes the corresponding strategy-only tools for compatible clients. The older clipboard bridge remains a recovery path, not the normal Direct workflow.
