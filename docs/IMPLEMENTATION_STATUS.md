# Implementation status — v0.3.14

Status: **release candidate**.

## Implemented
- Authoritative transaction-cost ledger, broker settings, fee/tax trade preview and deterministic quick trade input.
- Trusted portfolio recomputation and historical net-P/L completeness flags.
- GPT Review Inbox (`PENDING -> GPT_SENT -> COMPLETED`).
- GPT update diff preview + ledger-safe strategy undo.
- Human-readable radar `現在等` state.
- Monitor-only Cloudflare Worker/D1 with no portfolio/cash/trade ledger.
- PC-off Trigger Event handoff path: Cloud Trigger -> opaque event URL -> phone -> fixed GPT conversation -> local reconcile when Backend returns.
- Cloud RVOL uses a time-adjusted daily-volume baseline; RVOL triggers without a baseline are explicitly not Cloud-ready.
- Standalone mobile Backend pairing: LAN URL + 6-digit one-time code, token persisted in SecureStore.
- Local and Cloud protected APIs fail closed when their configured secrets are absent.
- Cloud Push retry bookkeeping, dead-token disabling and same-symbol Fugle quote grouping.
- Push diagnostics plus a non-trading `test-cloud-push.ps1` path.
- Cloudflare and EAS one-time setup scripts plus EAS preview-build helper.
- Active-install pointer, hash-manifest backup, guarded production Installer and matching Rollback.
- Node.js 20.19+ guard in Expo-related launch/verification/deployment scripts and Installer.

## Verified in this workspace
- Backend: **77/77 tests pass**.
- Cloud Worker: **9/9 tests pass**.
- Mobile + MCP TS/TSX transpile syntax: **22 files / 0 syntax errors**.
- Release contract / Installer-Rollback static contract / package cleanliness: PASS.
- Cloud migration is monitor-only and contains no demo account/market seed.

## One-time user-environment activation / verification
- Full Expo/React typecheck is mandatory inside the Windows Installer after it installs the dependency tree; install aborts before active cutover if this fails.
- Windows-specific backup/cutover is performed by the supplied PowerShell Installer; the cross-platform core verifier is the same script used in this workspace.
- Cloudflare deployment requires the user's account once.
- Expo/EAS project initialization and push-capable preview/standalone build require the user's account once.
- Real phone cold-start notification and PC-off end-to-end trigger flow are not yet verified.

Installing v0.3.14 advances the active baseline only after the guarded Installer completes successfully.
