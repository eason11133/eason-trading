# Eason Trading

> A mobile monitoring and decision-support tool for my Taiwan-stock workflow.

I built Eason Trading to keep the parts of my daily process that used to be scattered across market apps, screenshots, notes, and chat in one stateful system: **holdings, candidate stocks, key price levels, volume conditions, and trade records**.

When a configured market condition changes in a meaningful way, Eason Trading creates an exact **Snapshot** of that event and notifies me. I then decide what to do next: inspect the market directly, or optionally hand the Snapshot and its context to GPT for analysis and discussion.

| Role | Responsibility |
| --- | --- |
| **Eason Trading** | Monitoring, persistent state, exact Snapshots, notifications, and safe synchronization |
| **GPT** | Optional strategy analysis/discussion and constrained strategy-only updates |
| **User** | Final decision maker for real market actions |
| **Yahoo Finance** | External chart, news, and market-inspection tool |

**Eason Trading does not place orders. GPT is not an automatic trader and cannot create trading truth. Any real buy/sell decision remains with the user.**

> **Current source line:** v0.3.19. The immutable prior production tag [v0.3.18-final-r3](https://github.com/eason11133/eason-trading/tree/v0.3.18-final-r3) remains the rollback baseline.

## Why I built this

My original workflow was fragmented. I checked charts and news in Yahoo Finance, tracked holdings and candidates separately, remembered price/volume conditions manually, and often moved screenshots or numbers into GPT when I wanted a second opinion.

The difficult part was not getting an AI answer. It was **keeping the state of the plan consistent over time and preserving the exact context that made an event worth reviewing**.

Eason Trading fills that missing layer. It keeps monitoring state active, watches deterministic conditions even when my PC is off, freezes the evidence into an event Snapshot when something meaningful happens, and lets me return to that context without reconstructing it by hand.

GPT is optional in this loop. I can inspect the market myself, or send a Snapshot / after-close package to GPT for structured analysis. GPT may return strategy-only updates through a constrained interface, but those updates cannot create cash, executed trades, or authoritative holding quantities. Any real trading decision remains mine.

## Core workflow

### During market hours

~~~text
Persistent state
(holdings / candidates / key levels / volume conditions / trade records)
        ↓
shared deterministic smart-trigger engine
        ↓
local backend + PC-off Cloudflare monitoring
        ↓
meaningful condition transition
        ↓
exact event Snapshot + notification
        ↓
User decides
   ├─ inspect the market directly
   └─ optionally send Snapshot/context to GPT
                    ↓
          strategy analysis / discussion
          (strategy-only state, never an order)

Any real trading action is still decided and executed by the user.
~~~

Notifications are not raw price-touch alerts. A rule can combine price, RVOL, VWAP, daily high/low, and percentage change; require consecutive qualifying ticks; enforce cooldown or one-shot behavior; reject stale strategy versions; and give invalidation precedence over an old entry thesis.

The Snapshot is immutable evidence for the event: trigger identity, market context, decision evidence, and strategy version stay correlated so a later review refers to the exact event that caused the notification.

### After market close

~~~text
Eason Trading prepares the daily close package
        ↓
User reviews it
        ↓
optional: send package to GPT
        ↓
analysis / strategy-only response
        ↓
validated strategy state for the next session

No order is placed by Eason Trading or GPT.
~~~

The close package carries tracked market/setup/trigger context while the GPT bridge deliberately omits cash amounts and executed-trade history. See [Architecture](docs/ARCHITECTURE.md#after-close-package) and [server/src/cloud-monitor.mjs](server/src/cloud-monitor.mjs).

## System architecture

~~~mermaid
flowchart TB
    USER[User<br/>final decision maker]
    APP[React Native / Expo app<br/>review UI, reminders, holdings, close review]
    BE[Local Node backend<br/>authoritative Ledger, validation, reconciliation]
    CF[Cloudflare Worker + D1<br/>PC-off monitor, events, transport, push orchestration]
    TRIGGER[Shared deterministic<br/>smart-trigger engine]
    FUGLE[Fugle market data]
    PUSH[Expo Push]
    GPT[GPT<br/>optional strategy analysis / discussion]
    YF[Yahoo Finance<br/>external market inspection]

    FUGLE --> BE
    FUGLE --> CF
    BE -. same evaluator .-> TRIGGER
    CF -. same evaluator .-> TRIGGER
    BE <-->|authenticated sync / reconciliation| CF
    BE <-->|LAN API after one-time pairing| APP
    CF --> PUSH --> APP --> USER
    USER -. optional handoff .-> GPT
    GPT <-->|strategy-only read/update surface| CF
    USER -. charts / news / market view .-> YF
~~~

D1 holds reconstructable monitoring, event, device, GPT-command, and durable mutation-transport state. It is **not** a second authoritative trading Ledger. The complete component and data-ownership model is documented in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Engineering highlights

- **Deterministic smart triggers:** one shared state machine implements qualification, invalidation, persistence, cooldown, one-shot, re-entry, and version checks. [shared/smart-trigger.mjs](shared/smart-trigger.mjs)
- **Exact Snapshot / event correlation:** a trigger freezes its market/context snapshot and carries the same event identity through notification, optional GPT handoff, no-change/apply, and completion. [server/src/review-triggers.mjs](server/src/review-triggers.mjs)
- **Hybrid local/cloud authority:** private trading truth stays local while Cloudflare can continue monitoring when the PC is off. [Architecture](docs/ARCHITECTURE.md#data-ownership)
- **Local/cloud semantic parity:** the Worker imports the same trigger engine used locally, with explicit parity tests. [cloudflare/src/worker.test.mjs](cloudflare/src/worker.test.mjs)
- **Ledger authority:** cash, executed trades, and authoritative holding quantity remain local Ledger truth.
- **GPT authority boundary:** GPT-facing tools expose strategy operations but no cash, trade, or authoritative-quantity operation; Cloud and local validation reject Ledger-shaped writes. [server/src/store.mjs](server/src/store.mjs), [cloudflare/src/worker.mjs](cloudflare/src/worker.mjs)
- **Idempotent reconciliation:** duplicate strategy payloads are detected, statuses only advance, retries are safe, and completed events are retried to Cloud. [server/src/gpt-update.test.mjs](server/src/gpt-update.test.mjs)
- **PC-off mobile Ledger transport:** user-authorized Ledger mutations can wait durably in D1 until the local authority reconnects, validates, applies exactly once, and acknowledges the result.
- **Release / rollback safety:** clean-package checks, isolated test state, installer/rollback contracts, PowerShell interoperability checks, and production audit gates protect the installed baseline. [scripts/verify-release.mjs](scripts/verify-release.mjs)
- **Mobile integration:** Expo/React Native UI, native SVG charts, SecureStore pairing, push-response routing, and EAS-compatible Android configuration. [mobile/](mobile/)

For a problem/decision/implementation/evidence view, see [docs/TECHNICAL_HIGHLIGHTS.md](docs/TECHNICAL_HIGHLIGHTS.md).

## PC-off mobile Ledger writes

Normal mobile Ledger actions do not require the PC to remain online. Add/edit/remove holding, cash correction, and **records of already executed** buy/sell activity are authenticated and durably appended to a Cloud queue. The phone reports **已提交，待同步**—never “completed”—until the local backend reconnects, validates the mutation, applies it exactly once, and acknowledges applied or rejected.

Cloud is transport, not a portfolio database: queued payloads and lifecycle status are non-authoritative. Cash, positions, trades, and all final Ledger truth remain in local state. A durable local applied-mutation index prevents replay after crashes or lost acknowledgements; position/cash preconditions reject stale corrections instead of guessing.

GPT uses a separate strategy-only surface and has no route or credential that can enqueue Ledger mutations.

## Safety boundary

| GPT may change | GPT must never change |
| --- | --- |
| Strategy and priority | Cash |
| Setup stage and rationale | Executed BUY/SELL records |
| Playbook levels | Authoritative holding quantity |
| Review-trigger conditions and policy | Ledger truth |
| Non-Ledger review state | Any representation of an executed order |

This is enforced at three layers: the remote Action/OpenAPI schema exposes strategy-only operations; Cloud rejects forbidden strategy keys; and the local backend converts an allowed command through the same validated update path before acknowledging it as APPLIED.

The read replica includes limited position context for reasoning but identifies itself as non-authoritative and excludes cash amounts and executed-trade history.

The reason is architectural, not prompt-based: an AI analysis can be wrong or incomplete, but it must never become a fabricated financial transaction. Evidence is summarized in [docs/TESTING_AND_SAFETY.md](docs/TESTING_AND_SAFETY.md).

## Validation

Source verification and live-environment auditing are deliberately separate.

The authoritative clean-source gates are:

~~~powershell
node .\scripts\verify-release.mjs
node --test .\shared\smart-trigger.test.mjs
~~~

A clean-source audit on **2026-09-29** passed with:

- **Backend:** 97/97 tests
- **Cloud Worker:** 28/28 tests
- **Shared smart-trigger engine:** 8/8 focused tests
- **Release / installer / rollback / Cloud / shell / audit contracts:** PASS
- **Package cleanliness:** PASS

The clean-source verifier intentionally has no installed mobile dependency tree, so Expo Doctor, real tsc --noEmit, and Android/iOS export smoke checks remain install-time/runtime gates rather than being faked in source-only CI.

The repository verifier uses isolated temporary state; it does not load the user's Ledger. The separate production audit checks authenticated local/cloud health, command-safe sync, a non-mutating GPT bridge PING, Expo push-ticket success, and an unchanged Ledger fingerprint. It requires explicit audit mode so unrelated pending strategy commands are held.

See [docs/TESTING_AND_SAFETY.md](docs/TESTING_AND_SAFETY.md), [FINAL_AUDIT.md](FINAL_AUDIT.md), and [scripts/audit-production.ps1](scripts/audit-production.ps1).

## Public repository safety

Real runtime/user data is intentionally outside the repository. The public tree excludes:

- local Ledger / state.json and backups
- real holdings, cash, and executed-trade runtime state
- .env.local and API tokens
- Fugle credentials
- Cloudflare secrets and generated Wrangler state
- real Firebase / google-services.json configuration
- Firebase Admin / service-account files
- device/pairing tokens
- keystores, private keys, APK/AAB output, and local backups

Tracked numeric portfolio/market values used by tests or the legacy demo seed are fixture data that production runtime does not load as the authoritative Ledger. .gitignore, clean-package checks, and release verification guard this boundary.

## Repository map

| Path | Evidence to inspect |
| --- | --- |
| [mobile/](mobile/) | React Native app, event-driven UI, pairing, push routing, SVG charts |
| [server/src/](server/src/) | Authoritative local state, Ledger operations, strategy validation, reconciliation |
| [cloudflare/](cloudflare/) | Worker, D1 migrations, PC-off monitor, GPT Action/OpenAPI, Expo Push |
| [shared/smart-trigger.mjs](shared/smart-trigger.mjs) | Deterministic rule and runtime-state implementation used locally and in Cloud |
| [scripts/](scripts/) | Release verification, production audit, deployment and rollback safeguards |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Components, ownership, event lifecycle, synchronization, failure behavior |
| [docs/ENGINEERING_STORY.md](docs/ENGINEERING_STORY.md) | How the design changed and what I learned |

## Tech stack

- JavaScript, TypeScript, and Node.js
- React Native and Expo (Android/iOS)
- Cloudflare Workers and D1
- Fugle market-data APIs
- Expo Push Notifications and EAS
- Custom GPT Actions / OpenAPI and remote MCP-compatible tools
- PowerShell release and production-audit tooling on Windows

## Status and external configuration

The current source line is **v0.3.19**. The immutable [v0.3.18-final-r3](https://github.com/eason11133/eason-trading/tree/v0.3.18-final-r3) tag remains the rollback baseline.

Source-side support for the GPT strategy surface, Cloud Worker, local backend, mobile app, and safety gates is present here. Attaching an Action to a particular Custom GPT and supplying account/platform secrets are external account-side operations; source tests do not pretend to prove those account-side steps.

Real .env files, google-services.json, Cloudflare secrets, runtime state, Ledger data, keystores, and APKs are excluded from Git.

Start with [START_HERE.md](START_HERE.md) for operation, [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for design, and [docs/TECHNICAL_HIGHLIGHTS.md](docs/TECHNICAL_HIGHLIGHTS.md) for a short technical review.
