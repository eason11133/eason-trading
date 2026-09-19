# Technical highlights

This document presents the strongest engineering decisions in Eason Trading v0.3.18 FINAL-R3. Each claim points to source or tests that can be inspected directly.

## 1. Local truth with PC-off monitoring

**Problem.** A personal trading assistant must keep monitoring when the PC is off without copying the entire financial Ledger into a public-cloud service.

**Decision.** Split authority: the local backend owns cash, holdings, costs, and trades; Cloudflare owns only reconstructable monitoring and delivery state.

**Implementation.** The backend projects armed targets and a limited GPT read model to D1. Cloud evaluates targets and queues events/commands, while the local backend reconciles and validates them.

**Why it matters.** Availability improves without creating two competing Ledgers or unnecessarily expanding the sensitive-data footprint.

**Evidence.** [`server/src/cloud-monitor.mjs`](../server/src/cloud-monitor.mjs), [`cloudflare/src/worker.mjs`](../cloudflare/src/worker.mjs), [`cloudflare/migrations/`](../cloudflare/migrations/)

## 2. One deterministic trigger engine in two runtimes

**Problem.** Separate local and cloud implementations could disagree about whether a rule fired.

**Decision.** Treat trigger evaluation as a pure, shared state machine.

**Implementation.** `shared/smart-trigger.mjs` supports price, RVOL, VWAP, high, low, and change percentage; comparison operators; `all`/`any` qualification; invalidation; consecutive samples; cooldown; one-shot; reusable re-entry; and playbook-version checks. Both runtimes import it.

**Why it matters.** A strategy has the same semantics whether the PC is online or Cloudflare is acting as backup.

**Evidence.** [`shared/smart-trigger.mjs`](../shared/smart-trigger.mjs), [`shared/smart-trigger.test.mjs`](../shared/smart-trigger.test.mjs), [`cloudflare/src/worker.test.mjs`](../cloudflare/src/worker.test.mjs)

## 3. Notifications represent transitions, not noisy ticks

**Problem.** Raw price-touch alerts repeat, flap near a boundary, and provide too little context for reassessment.

**Decision.** Notify only when a qualified condition becomes stably true, with explicit persistence and re-entry behavior.

**Implementation.** The engine tracks streak, stable state, last candidate match, cooldown suppression, and last fire time. Reusable triggers require exit and re-entry; one-shot triggers cannot fire twice.

**Why it matters.** The phone receives fewer but more meaningful review requests.

**Evidence.** [`shared/smart-trigger.mjs`](../shared/smart-trigger.mjs), [`shared/smart-trigger.test.mjs`](../shared/smart-trigger.test.mjs)

## 4. Frozen evidence and exact event identity

**Problem.** Asking GPT to reassess “the latest condition” later can use different market data from the moment that caused the alert.

**Decision.** Freeze the evidence at fire time and carry one event identity through the entire workflow.

**Implementation.** Local firing first claims the trigger, then captures multi-timeframe market data and strategy context. Cloud events likewise persist a snapshot. `reviewEventId` correlates push, handoff, GPT response, apply/no-change, and completion.

**Why it matters.** A review is explainable and auditable: the response refers to the event that actually triggered it.

**Evidence.** [`server/src/review-triggers.mjs`](../server/src/review-triggers.mjs), [`server/src/cloud-monitor.mjs`](../server/src/cloud-monitor.mjs), [`cloudflare/src/worker.mjs`](../cloudflare/src/worker.mjs)

## 5. AI writes strategy, never financial truth

**Problem.** An AI-generated response must not fabricate an executed order or mutate money and position records.

**Decision.** Enforce authority in schemas and code, not only in prompt instructions.

**Implementation.** The remote surface exposes strategy operations but no Ledger operation. Cloud rejects forbidden keys; the local store independently rejects cash, position, portfolio, trade, Ledger, and realized-P/L fields before applying a command.

**Why it matters.** Even an incorrect or malicious payload cannot cross the architectural boundary into an executed trade.

**Evidence.** [`server/src/store.mjs`](../server/src/store.mjs), [`server/src/gpt-update.test.mjs`](../server/src/gpt-update.test.mjs), [`cloudflare/src/worker.mjs`](../cloudflare/src/worker.mjs)

## 6. Idempotent asynchronous reconciliation

**Problem.** Mobile networks, Worker retries, and an offline PC make duplicate delivery normal rather than exceptional.

**Decision.** Design commands and event status changes to be replay-safe.

**Implementation.** Strategy payloads receive normalized hashes for duplicate detection. Cloud status advances monotonically. Imported events are idempotent, command acknowledgement records `APPLIED` or `FAILED`, and incomplete completion sync is retried.

**Why it matters.** Recovery after disconnection does not duplicate a strategy update or move an event backward.

**Evidence.** [`server/src/cloud-monitor.mjs`](../server/src/cloud-monitor.mjs), [`server/src/store.mjs`](../server/src/store.mjs), [`server/src/gpt-update.test.mjs`](../server/src/gpt-update.test.mjs)

## 7. Pairing and fail-closed authentication

**Problem.** A standalone phone app needs local access without embedding a permanent backend credential in the APK.

**Decision.** Pair interactively, store the resulting credential in the platform secure store, and refuse protected operation when secrets are absent.

**Implementation.** Pairing codes are six digits, short-lived, one-time, and throttled. Protected APIs require configured credentials; the mobile client stores its token through SecureStore.

**Why it matters.** Distribution artifacts remain credential-free and an unconfigured server does not silently become public.

**Evidence.** [`server/src/pairing.mjs`](../server/src/pairing.mjs), [`server/src/auth.mjs`](../server/src/auth.mjs), [`mobile/`](../mobile/)

## 8. Verification protects source and live state

**Problem.** Passing unit tests is insufficient if packaging leaks secrets or a production audit mutates the user's Ledger.

**Decision.** Separate isolated source verification from an explicit, non-mutating production audit.

**Implementation.** The release verifier creates temporary seeded state, runs backend/cloud contracts, checks packaging and rollback invariants, and performs TypeScript gates when dependencies exist. The production audit fingerprints Ledger fields, blocks command application, uses a non-trading `PING`, and compares the fingerprint afterward.

**Why it matters.** Verification itself has a defined safety boundary.

**Evidence.** [`scripts/verify-release.mjs`](../scripts/verify-release.mjs), [`scripts/audit-production.ps1`](../scripts/audit-production.ps1)
