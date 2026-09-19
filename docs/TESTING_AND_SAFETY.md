# Testing and safety

Eason Trading separates source verification from live-environment auditing. The first must be repeatable without credentials; the second is explicit and must prove that observation did not change the user's Ledger.

## Source verification

Run from the repository root:

```powershell
node .\scripts\verify-release.mjs
node --test .\shared\smart-trigger.test.mjs
```

The FINAL-R3 verification baseline is:

| Gate | Expected result |
| --- | ---: |
| Backend tests | 91/91 |
| Cloud Worker tests | 24/24 |
| Shared trigger focused tests | 8/8 |
| Release/package contracts | PASS |
| Expo Doctor in release environment | 21/21 |
| TypeScript after dependency installation | PASS |
| Android/iOS export smoke gates | PASS |

`verify-release.mjs` creates a temporary state directory and enables a test seed. It does not use the installed application's `state.json`. When dependencies are available it invokes real TypeScript checking rather than treating syntax transpilation as type verification.

## What is tested

- Ledger math, transaction costs, portfolio recomputation, and historical-completeness behavior.
- Strategy update validation, forbidden fields, duplicate detection, apply, and safe undo.
- Trigger qualification, invalidation, persistence, cooldown, one-shot, reusable re-entry, and version changes.
- Local/cloud semantic parity and monitor readiness, including RVOL baseline requirements.
- Cloud authentication, D1 state transitions, monotonic event status, retry behavior, and dead push-token handling.
- Pairing expiry, one-time use, throttling, and protected API behavior.
- Installer, backup, rollback, package-content, and version contracts.

## Production audit

[`scripts/audit-production.ps1`](../scripts/audit-production.ps1) is intentionally separate from the normal test suite. It requires `EASON_AUDIT_MODE=1` and verifies the configured deployment rather than inventing test credentials.

The audit:

1. checks authenticated local and cloud health and version identity;
2. verifies the deployed Action/OpenAPI contract and exact event-correlation fields;
3. synchronizes while command application is disabled;
4. queues and acknowledges a non-mutating bridge `PING` without draining real strategy commands;
5. optionally requires a successful Expo push ticket;
6. fingerprints positions, trades, and cash before and after, then requires equality.

It must not be used as an excuse to expose tokens in terminal output or logs. Secrets stay in ignored local configuration and platform secret stores.

## Defense in depth

| Risk | Primary controls |
| --- | --- |
| GPT invents a trade | No trade/cash/quantity tool; forbidden-key validation in Cloud and local store |
| Duplicate network delivery | Idempotent imports, normalized command hashes, monotonic statuses |
| Local/cloud rule drift | Both import the shared trigger engine; parity tests |
| Stale strategy fires | Playbook-version check |
| Alert flapping | Consecutive qualification, stable transition, cooldown, re-entry |
| Missing credentials | Protected APIs fail closed |
| Credential in source | `.gitignore`, sanitized examples, release cleanliness and tracked-file audits |
| Test mutates real state | Temporary test state; explicit production audit mode and Ledger fingerprint |

## Repository cleanliness

Real environment files, API keys, Firebase Admin credentials, Firebase client configuration, Cloudflare secrets, Expo credentials, keystores, runtime state, Ledger data, device tokens, build output, APKs, logs, and dependency directories must remain untracked. Before publication, inspect `git ls-files`, scan tracked text for credential patterns, and confirm that only documented placeholders appear.

The immutable production baseline remains tag `v0.3.18-final-r3`; documentation updates do not move that tag or change production behavior.
