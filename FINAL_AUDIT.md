# Eason Trading v0.3.18 FINAL release audit

This release is intentionally scoped to the real daily workflow:

- Market hours: stay quiet, monitor GPT-defined structured conditions in Cloud, and push only when a setup becomes meaningfully worth re-evaluating.
- Notification tap: preserve the exact event, its snapshot, original setup/playbook and decision evidence for GPT.
- After close: prepare a close-review package and make `交給 GPT 復盤` the primary App action.
- Yahoo remains the market-browsing/chart/news surface. Eason Trading is the state/monitor/data bridge.

## Fully audited invariants

- Local Ledger remains authoritative. GPT/Cloud cannot write cash, executed trades, or holding quantities.
- Cloud is monitor/event/GPT bridge only; it is not a second portfolio.
- Smart-trigger local and Cloud state machines share the same implementation and parity tests.
- Invalidation takes precedence over review-zone notification.
- Cooldown/state-transition logic suppresses price-line spam.
- Cloud quotes are rejected for smart-trigger evaluation when the provider date is not the current Taipei date, provider timestamp is stale, trial mode is active, or trading is halted.
- The exact notification event the user taps is promoted to GPT review context even if newer events exist.
- GPT updates carry `reviewEventId`; `NO_CHANGE` can close an event without changing strategy or Ledger.
- Completed local Cloud review status retries idempotently to Cloud.
- Normal GPT Action flow does not require raw `EASON_TRADING_UPDATE_V1`; clipboard JSON remains failure fallback only.
- Production audit uses `applyCommands=false` and a dedicated exact PING roundtrip, so the audit itself does not drain unrelated pending GPT strategy commands.
- Production audit fingerprints Ledger truth before/after and hard-fails on any Ledger mutation.
- Expo Go is not part of the production workflow.
- Cloud Wrangler is pinned to 4.131.2; EAS CLI is pinned to 24.3.0.

## Source-level gates run on this FINAL source

The release is not considered ready unless all of these pass together:

- Backend/server test runner
- Cloud Worker tests
- Shared smart-trigger tests
- release contract
- installer contract
- package cleanliness
- rollback merge contract
- Cloud module-pair contract
- Cloudflare CLI runner contract
- Cloud setup full simulation
- mobile tooling resolution contract
- SDK 57 mobile API regression contract
- PowerShell/shell interop contract
- production-audit contract
- complete `verify-release.mjs`

## Windows pre-cutover gates run by the FINAL updater

Before changing `eason-trading-current.txt`, the updater must run on the exact promoted runtime:

1. Backend/server tests.
2. Cloud Worker tests.
3. Shared smart-trigger tests.
4. Release/installer/package/rollback/Cloud/mobile/audit contract checks.
5. Imported-Ledger isolated smoke test.
6. Expo SDK 57 dependency compatibility check.
7. Expo Doctor.
8. Expo config/plugin validation.
9. Real TypeScript `tsc --noEmit`.
10. Android Expo export bundle smoke.
11. iOS Expo export bundle smoke.
12. Start v0.3.18 and require verified Fugle market data.
13. Deploy the FINAL Cloud Worker/D1 migration/secrets.
14. Restart Backend and perform command-safe full Cloud sync.
15. Run live production audit: Backend, Cloud health, GPT Action OpenAPI, fresh GPT bridge, exact synthetic PING roundtrip, real Expo push ticket, and unchanged Ledger fingerprint.
16. Only then cut the active pointer to v0.3.18.
17. Build the final Android APK with pinned EAS CLI 24.3.0.

If any step before pointer cutover fails, the previous active root is restored/restarted. An EAS cloud-build failure after successful promotion does not roll back a healthy local/Cloud v0.3.18 installation.


## Windows ESM path regression caught by real preflight

The first FINAL-AUDITED Windows run correctly stopped before dependency install/cutover because `check-cloud-setup-full-sim.mjs` passed a raw Windows drive path to Node's `--import` flag. Node treats `C:\...` there as the unsupported `c:` URL scheme.

This release fixes that class of bug by:

- converting the preload module path with `pathToFileURL(mockPath).href` before passing it to `node --import`;
- reusing the same converted module URL for first-run, resume, and readiness-only Cloud setup simulations;
- adding a release-contract regression that fails on Linux too if the Cloud simulation ever regresses to `['--import', mockPath, ...]` instead of a `file://` module URL;
- auditing all repository uses of Node loader flags and dynamic module-path conversion. No other raw filesystem path is passed to `--import`, `--loader`, or `--experimental-loader`.

After this change, the exact source was re-run through complete `verify-release.mjs`: Backend 91/91 PASS, Cloud 24/24 PASS, all static contracts PASS, full Cloud setup simulation PASS, and package cleanliness PASS. Shared smart-trigger 8/8 PASS was also re-run separately.

## External acceptance that source tests cannot truthfully prove

Three final behaviors require the real external environment:

- The EAS cloud service must finish the final Android APK build. The FINAL updater performs this after promotion.
- Expo accepting a push ticket proves delivery was accepted by Expo, but only the physical phone can prove that Android visibly displayed the notification and that the user tap opened the intended app/GPT path.
- The Worker can prove the Action/OpenAPI/bearer bridge is ready. Only one real invocation inside the user's Custom GPT can prove the account-side GPT editor actually has that Action attached.


## FINAL updater enforcement added after audit

The production installer now enforces the audit sequence it documents instead of merely describing it:

- static source/installer/Cloud/mobile contracts are run on the exact clean source before dependencies are installed;
- Backend, Cloud and shared smart-trigger tests run on the exact installed dependency tree;
- EAS authentication is verified before the active baseline is stopped;
- the candidate Backend is first started with `EASON_AUDIT_MODE=1`, so real pending GPT strategy commands are held;
- the FINAL Worker is deployed, then a command-safe `applyCommands=false` sync is required;
- `scripts/audit-production.ps1` must pass before active-pointer cutover, including exact PING, GPT Action/OpenAPI/readiness, Expo push ticket and Ledger fingerprint checks;
- the candidate is then restarted once in normal mode and Ledger truth is fingerprinted again;
- only after that normal-mode smoke passes is `eason-trading-current.txt` changed;
- the pinned EAS Android APK build is submitted only after successful local/Cloud promotion.

A failed pre-cutover gate restores/restarts the prior active root. A post-promotion EAS build failure does not roll back a healthy v0.3.18 local/Cloud installation.


## Post-enforcement source rerun

After the installer enforcement changes above, the exact clean source was re-run through:

- Backend isolated suite: 91/91 PASS.
- Cloud Worker suite: 24/24 PASS.
- Shared smart-trigger suite: 8/8 PASS.
- Release contract PASS.
- Installer/Rollback contract PASS.
- Package cleanliness PASS.
- Rollback merge PASS.
- Cloud module-pair PASS.
- Cloudflare CLI runner PASS.
- Full Cloud setup simulation PASS.
- Mobile tooling-resolution contract PASS.
- SDK57 mobile API regression PASS.
- PowerShell/shell interop contract PASS.
- Production-audit contract PASS.
- Complete `verify-release.mjs` PASS.

The clean source intentionally contains no `node_modules`; Expo Doctor, real TypeScript, Android export and iOS export are therefore repeated by the Windows FINAL updater after installing the exact dependency tree and before it stops the current active version.

## FINAL-R3 APK submission audit
- Windows production run proved code/cloud/backend/push-ticket/Ledger gates and active-pointer promotion all pass.
- Found one post-promotion-only bug in scripts/build-android-apk.ps1: PowerShell automatic `$args` was reused as a parameter/splat, causing bare `eas` help to print three times while returning exit code 0. No APK build was actually submitted in FINAL-R2.
- Builder now uses direct, explicit pinned EAS CLI 24.3.0 commands, waits for Android preview completion, then verifies the latest finished v0.3.18 preview build.
- setup-expo-push.ps1 and build-mobile-push-test.ps1 are also pinned to 24.3.0.
- Release contract rejects `$Args`/`@Args` in the APK builder and rejects operational `eas-cli@latest`.
- Post-fix source audit: Backend 91/91 PASS, Cloud 24/24 PASS, smart-trigger 8/8 PASS, full verify-release PASS.
