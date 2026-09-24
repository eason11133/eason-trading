# v0.3.18 final audit hardening

- Notification handoff now makes the exact tapped Cloud event the preferred GPT review event, preventing a newer unrelated trigger from stealing the conversation.
- Direct GPT strategy writes carry `reviewEventId`; `NO_CHANGE` can close a reviewed event without modifying strategy or Ledger. Completed local Cloud review events are retried back to Cloud idempotently.
- Cloud Fugle monitoring validates the provider trading date and provider timestamp before evaluating triggers, avoiding stale/holiday quote alerts.
- Removed unused legacy Cloud clipboard handoff code and removed Expo Go login as a production/release requirement.
- Pinned the already-proven Wrangler 4.131.2 and EAS CLI fallback 24.3.0 to reduce release-tool drift.


## v0.3.18 FIX4
- Fixed the production Backend -> Cloud authentication path: `cloudMonitorConfig()` intentionally exposed only `apiKeyConfigured`, but the internal request helper incorrectly tried to read `cfg.apiKey`, so privileged Cloud calls omitted `x-api-key` and `reconcileCloudEvents` returned `unauthorized`.
- Cloud requests now read `CLOUD_MONITOR_API_KEY` directly for the private request header while the public config object remains secret-free.
- Cloud monitor is considered configured only when both the Worker URL and a valid Cloud API key are present.
- Added a regression test proving every private Cloud request sends the exact configured `x-api-key`.

## v0.3.18 FIX3 - promotion/cloud-sync hardening
- Restart the new Backend after Cloudflare deployment so runtime env reloads any Cloud URL/API/MCP settings written by setup.
- `/v1/cloud-monitor/sync` now reports the exact failing stage instead of a generic 502.
- Legacy v0.3.16 review triggers are normalized to the v0.3.18 smart-trigger policy/runtime model; malformed active triggers fail safe by cancelling only that trigger, never Ledger data.
- Cloud setup no longer mislabels every local sync failure as "Backend not running".
- Installer template now discovers v0.3.16 roots without requiring the v0.3.18-only `start-backend.ps1`.

## v0.3.18 FIX2
- Fixed production backend launcher readiness race: `/health` can return `ok` before asynchronous Fugle verification completes. The launcher now waits for `marketDataVerified=true` before declaring readiness.
- Added install-source regression guard so this premature-readiness bug cannot silently return in a release package.
# v0.3.16 UI1 — mobile information hierarchy refresh

- UI-only refresh; no GPT, trigger, ledger, market-data, cloud-monitor, or API behavior changed.
- Radar replaces large system/debug cards with compact status chips and keeps immediate actions first.
- Portfolio setup warnings are consolidated; asset summary is simplified and historical-cost caveats move behind a compact explanation row.
- Notifications are split into priority items and quieter history records; push/cloud readiness is shown as compact status chips.
- Backend offline state is a compact reconnect banner instead of a full-width diagnostic sentence.
- Adds the new Eason Trading app icon and keeps the existing Expo/EAS/Firebase Android build linkage in the cumulative source.

# Changelog

- v0.3.16 FIX4: React Native 0.86 / Expo SDK57 mobile typecheck compatibility: replace removed `StyleSheet.absoluteFillObject` usage in AddWatchModal, QuickTradeModal, and TradeModal with `StyleSheet.absoluteFill`, and add a release regression gate that rejects the removed API before packaging.
- v0.3.16 FIX3: SDK57 validation no longer compares dependency declaration strings literally with Expo's bundledNativeModules ranges. `expo install --fix` normalizes the tree, `expo install --check` is the authoritative compatibility gate, and the exact resolved graph is frozen by package-lock + SHA proof. Expo source range starts at ~57.0.22 and expo-notifications at ~57.0.18; future SDK57 patch releases no longer require a new installer merely because Expo's recommended patch-range text changes.

# v0.3.16 — Expo SDK 57 production release

- Mobile upgraded to Expo SDK 57.0.21, React Native 0.86.3 and React 19.2.3.
- Production update is now one-step: isolated SDK57 verification automatically flows into installation only after all mobile gates pass.
- The exact SDK57 dependency graph is SHA-bound to the source ZIP and reproduced with `npm ci` during production staging.
- Active v0.3.15 remains online during the long SDK57 staging verification.
- Fresh ledger and `.env.local` are copied only after v0.3.15 is stopped and backed up.
- v0.3.16 must pass Backend/Fugle/quotes/Web live startup smoke before the active-install pointer moves.
- Failed promotion keeps/restores the v0.3.15 pointer and attempts to restart the previous install.
- Server tests now use isolated temporary DB files even through normal `npm test`, preventing release-source state pollution.

# v0.3.16 SDK57 WIP8
- Server `npm test` now uses an isolated temporary DB and sequential test files, preventing developer test runs from polluting `server/data` or racing shared state.
- Release verification checks package cleanliness before tests as well as after them.
- Production installer now finds the exact source ZIP by SHA-256, avoiding false failures when several WIP/final v0.3.16 archives coexist in Downloads.
- Active pointer cutover is now last: v0.3.16 must start successfully and report Backend 0.3.16, Fugle verified, quotes ready, and Web listener ready before `eason-trading-current.txt` is changed.
- Failed live startup leaves the v0.3.15 pointer intact and automatically restarts the previous install.

# Changelog

## v0.3.16
- SDK57 FIX2: align TypeScript to `~6.0.3` and remove unused/deprecated `compilerOptions.baseUrl`, fixing the real Windows SDK57 `tsc --noEmit` gate under TypeScript 6.

- Fixed Windows SDK57 preflight native npm forwarding: never reuse PowerShell automatic `$args`; npm install/view now use explicit arguments, preventing `Unknown command: pm`.
 SDK57 WIP6
- Replaced the hard-coded WIP4/WIP5 preflight filename path with an exact-WIP renderer that binds one source ZIP filename, label and SHA-256 into the generated Windows preflight.
- Added one clean-cache npm retry for transient/stale `ETARGET` failures without touching the user's normal npm cache.
- A successful networked SDK57 preflight now exports the normalized `mobile/package.json`, generated `mobile/package-lock.json`, and a verification manifest with hashes and resolved core versions.
- The final release can therefore use the exact dependency graph that actually passed Expo Doctor, true TypeScript checking, and Android/iOS bundle smoke instead of resolving an unpinned graph again.
- The isolated preflight still never mutates the active pointer, production Ledger, `.env.local`, Cloudflare deployment, or secrets.

- SDK57 WIP4: switched SDK57 installation to an isolated fresh npm cache on the official registry after WIP3 hit a stale-metadata ETARGET for an Expo package that is published. Expo pin advanced to 57.0.21; Expo-owned native modules are still normalized by `expo install --fix --npm` before release gates.

## v0.3.16 — Expo SDK 57 mobile compatibility
- Added an isolated SDK57 Windows preflight that never changes the active pointer, Ledger, `.env.local`, Cloudflare Worker or secrets; it validates the exact WIP ZIP in `%TEMP%` before production promotion.
- SDK57 staging now runs the installed Expo 57.0.21 `expo install --fix --npm` before dependency check/Doctor/config/typecheck/bundle gates, so Expo-owned native patches come from Expo's own compatibility ledger instead of hand-maintained guesses.
- `verify-install-runtime.mjs --typecheck-only` no longer requires trading/Fugle secrets; mobile compatibility verification is now secret-free and safe to run in isolated staging.
- Upgraded mobile runtime from Expo SDK 54 / React Native 0.81 to Expo SDK 57 / React Native 0.86.3 / React 19.2.3.
- Raised Node.js minimum to 22.13, matching Expo SDK 57.
- Updated Expo Notifications, Constants, Clipboard, SecureStore and BuildProperties to SDK 57-compatible versions.
- Added SDK57 cutover verification: local Expo dependency check, pinned Expo Doctor, config/plugin validation, true TypeScript check, and Android/iOS Metro export smoke before the active pointer can move.
- Replaced deprecated core SafeAreaView with react-native-safe-area-context for SDK57 edge-to-edge handling.
- Expo Go Android now skips unsupported remote push-token registration while keeping the app usable; real PC-off push remains on EAS preview/standalone builds.
- Mobile/web startup now launches the installed Expo CLI directly; SDK57 mobile startup verifies Expo account login before showing the Expo Go QR.
- Installer preserves the already-active GPT Action Worker source so the SDK-only upgrade cannot regress the deployed Direct GPT schema fix.
- Expo Go users on current SDK 57 can load the app after signing into the same Expo account in CLI and Expo Go where required.

## v0.3.15 Cloud Hotfix WIP9
- Fixes the WIP8 readiness hotfix packaging bug: `setup-cloud-monitor.mjs` and `cloudflare-setup-core.mjs` are now treated as one atomic runtime pair.
- A new module-pair release check resolves every named import used by the Cloud setup orchestrator against the core helper before a hotfix/source snapshot can pass.
- The WIP9 readiness hotfix backs up both runtime files, writes both, verifies both SHA-256 hashes, and restores both if either write/hash fails.
- Readiness-only resume remains non-destructive: no Wrangler, D1 migration, Worker deploy, or secret upload is invoked.

## v0.3.15 Cloud Hotfix WIP8
- Cloud final-deploy verification now polls readiness flags, not just HTTP availability.
- Prevents a freshly deployed Worker from being rejected when Cloudflare briefly serves the prior bootstrap deployment with `PUBLIC_BASE_URL` still empty.
- Health timeout now prints the last observed health JSON/error so future failures identify the exact missing readiness flag.
- Full Cloud setup simulation now forces two stale bootstrap health responses before the final deployment becomes ready.

## 0.3.15 cloud hotfix WIP7

- Replaces Wrangler's retired `/workers/onboarding` dashboard link with Cloudflare's current Workers & Pages entry.
- The setup now tells the user to configure `Your subdomain` via Change/Set up, then resumes the existing bootstrap deploy checkpoint without recreating D1 or migrations.

# v0.3.15 Cloud setup hotfix WIP6 — workers.dev onboarding + resumable deploy

- Detects the exact first-account Cloudflare error that requires a `workers.dev` account subdomain.
- Opens the Cloudflare-provided Workers onboarding URL and waits for the user to finish the one-time account setup, then retries bootstrap deploy in-place.
- Adds a non-secret `.eason-cloud-setup-state.json` checkpoint so an onboarding interruption does not recreate D1 or reapply an unchanged migration set on the next run.
- Migration resume is fingerprinted from the migration filenames + contents, so a future real schema change still runs normally.
- D1 migration application is captured/non-interactive; the setup no longer needs an extra `Y` confirmation when replayed by the Node orchestrator.
- Full simulation now covers: OAuth -> D1 -> migrations -> workers.dev onboarding failure -> retry -> secrets -> final deploy -> readiness, plus a second-run resume assertion.

# v0.3.15 Cloud setup hotfix WIP5 — Node Wrangler orchestrator

- Replaced PowerShell-native Wrangler process control with a Node `spawnSync` orchestrator to remove Windows stderr/ErrorRecord, `$LASTEXITCODE`, and argument-splatting failure classes.
- Cloud auth uses `whoami --json`, with `login --device` on Wrangler 4.119+ and standard browser login as compatibility fallback.
- Reordered first deployment so D1/migrations happen first, then a no-cron bootstrap Worker is created, then secrets are piped to the existing Worker, then the final cron-enabled deployment is published.
- Added a full end-to-end fake Cloudflare setup simulation covering all Wrangler argv, secret stdin, generated `wrangler.toml`, generated `.env.local`, health/MCP/Action readiness and local sync.
- GPT Action helper no longer exposes the raw Bearer token in terminal output or setup files; it copies the token to the Windows clipboard and prints only a fingerprint.
- No trading, Ledger, trigger, or strategy semantics changed.

# Cloud setup hotfix WIP4 (v0.3.15 baseline)

### v0.3.15 Cloud setup hotfix WIP4 — Windows Wrangler argv/auth fix
- Fixed PowerShell helper argument binding that could launch bare `wrangler` help instead of `whoami/login/d1`.
- Renamed helper parameter from `$Args` to `$WranglerArgs` and requires explicit `-WranglerArgs @(...)` binding for every helper call.
- Authentication readiness now uses `wrangler whoami --json`; an unauthenticated non-zero result triggers `wrangler login --device`, followed by a required `wrangler whoami` confirmation before D1/deploy.
- Release contract rejects positional array splatting and rejects `auth token` as an authentication probe.

- Fix Windows PowerShell unauthenticated Wrangler probe: `wrangler auth token --json` is now executed through `Invoke-WranglerProbe`, which locally suppresses native stderr termination long enough to read the real exit code.
- Expected `Not logged in` now flows into Wrangler OAuth login instead of aborting setup.
- Release contract now requires the probe helper and rejects a direct captured auth-token invocation.
- Trading/ledger logic is unchanged.

# v0.3.15 Cloud setup hotfix WIP2

- Fixed Cloudflare OAuth bootstrap on Windows PowerShell wrappers: setup no longer lets a captured `d1 list --json` call become the first authenticated command.
- Setup now probes local Wrangler credentials with `wrangler auth token --json`, explicitly opens OAuth when absent, prefers `wrangler login --device` on Wrangler 4.119+, and confirms `wrangler whoami` before D1/deploy operations.
- Keeps the prior direct Node -> Wrangler JS launcher; no `npx wrangler` path is reintroduced.
- No trading, Ledger, Trigger, Cloud strategy-command semantics, or mobile UI logic changed.

# v0.3.15

- Added a real GPT Direct strategy bridge instead of relying only on the clipboard return path.
- Added Cloudflare read-only GPT strategy/position replica and durable strategy-command queue.
- Added bearer-authenticated remote MCP tools for reading state, updating strategy, undoing the last GPT strategy update and checking command status.
- Added matching GPT Action REST endpoints plus a dynamic OpenAPI schema; MCP and Actions share the exact same command queue and safety boundary.
- Local Backend now syncs GPT context and automatically reconciles pending strategy commands. Direct commands still pass through the existing `EASON_TRADING_UPDATE_V1` strategy validator before apply.
- Removed `record_trade` and `initialize_ledger` from the GPT-facing local MCP surface.
- The remote GPT replica intentionally contains no cash balance or executed-trade history, and direct regression tests prove cash/positions/trades are unchanged by GPT strategy updates.
- Added fail-closed separate MCP bearer authentication and Cloud setup verification.
- Added GPT Action readiness/heartbeat status, online apply acknowledgement (`applied` vs `PENDING`), public instruction/privacy endpoints, and one-time `setup-gpt-action.ps1` onboarding helper.
- Radar/Backend health now surface GPT Direct bridge runtime status; clipboard Sync/Apply remain fallback only.
- Final release verification: Backend **81/81**, Cloud Worker **16/16**, release/installer/package contracts PASS.

# v0.3.14

- Fixed the standalone/mobile UI typecheck blocker: added the missing `backendError` and `backendErrorText` StyleSheet entries used by the persistent pairing/error banner.
- Release qualification now requires a real `tsc --noEmit` pass against the same root-hoisted npm-workspace layout seen on the Windows installer path before an installable package is published.
- Installer now validates the imported legacy ledger before spending time on npm dependencies, then runs the real mobile `tsc --noEmit` as the final gate before switching the active pointer.
- No trading logic, ledger semantics, trigger behavior, or Cloud monitor behavior changed from v0.3.13.

# v0.3.13

- Windows installer hotfix: install-time dependency verification now resolves Expo/TypeScript through Node module resolution from `mobile/package.json`, so npm workspace-hoisted packages in root `node_modules` are accepted.
- Added regression coverage for both workspace-hoisted root dependencies and mobile-local dependencies.

- Windows release-verifier hotfix after the v0.3.11 rollback-merge check exposed `C:\\C:\\...` path duplication.
- `check-rollback-merge.mjs` now resolves its own module path with `fileURLToPath(import.meta.url)`, which preserves Windows drive-letter semantics.
- Release contract now rejects any executable `.mjs` script that reads `import.meta.url` through raw `.pathname`, preventing the same Windows file-URL bug from reappearing elsewhere.
- Windows Installer no longer runs developer-only unit/release-contract checks on the user PC; it now uses a small clean-package check before import, then a real mobile `tsc --noEmit` + copied-ledger backend smoke check after dependencies are installed.
- No trading logic, ledger semantics, Cloud trigger behavior, or mobile UI behavior changed from v0.3.11.

# v0.3.11

- Windows installer verifier hotfix after the v0.3.10 clean-source failure.
- Clean extracted source packages no longer require TypeScript before `npm install`; server/cloud/security/package checks still run before private state is copied.
- After mobile dependencies are installed, one authoritative `node <typescript>/bin/tsc --noEmit` gate performs the real Expo/React TypeScript verification before the active-install pointer can move.
- Removed the redundant TypeScript syntax subprocess/compiler-discovery path that could create a second Windows-only failure.
- No trading logic or user ledger semantics changed from v0.3.10.


## 0.3.9

- Added persistent standalone-phone Backend pairing with one-time 6-digit code and SecureStore token persistence.
- Local and Cloud privileged APIs now fail closed when API secrets are absent.
- Added Cloud push retry bookkeeping, dead-device disabling, same-symbol quote grouping, RVOL readiness handling, Cloud event reconciliation and device sync.
- Added non-trading Cloud push self-test endpoint and `scripts/test-cloud-push.ps1`.
- Reworked Installer/Rollback around explicit active-install pointer + hash-checked backup manifests; no dependency junction reuse.
- Rollback now snapshots and carries forward the latest active Ledger instead of blindly restoring the pre-upgrade state and losing post-upgrade trades.
- Added Android cleartext-LAN and iOS local-network/ATS native build declarations required by the standalone phone-to-PC connection.
- Added Node 20.19+ guards and expanded release/installer contracts.
- Promoted v0.3.9 to guarded install release: the Windows Installer performs the full mobile typecheck before switching the active-install pointer; Cloudflare/EAS account setup remains a one-time post-install activation step.

# v0.3.9 WIP2

- Continued cumulatively from v0.3.9 WIP1; this is a source handoff snapshot, not an install release.
- Closed the Cloud Trigger handoff loop through phone direct event fetch, local event reconciliation and GPT completion sync.
- Rebuilt Cloudflare as monitor-only storage; no cash, positions, trades or demo ledger data.
- Added PC-off time-adjusted RVOL evaluation from synchronized daily-volume baselines.
- RVOL-dependent triggers without a baseline are now explicitly not Cloud-ready instead of silently failing.
- Added one-minute Cloud reconcile/re-sync so newly populated baselines arm fallback monitoring without a restart.
- Added EAS/push registration diagnostics in Mobile.
- Added Cloudflare setup, EAS linking and push-capable preview-build helper scripts.
- Added release verification and package-clean checks; WIP Installer/Rollback preserve state, secrets, EAS project link and Cloudflare runtime config.
- Current workspace verification: Backend 72/72, Cloud Worker 5/5, Mobile+MCP syntax 20/20.

# v0.3.8

- Hardened long-running state persistence. High-frequency Fugle WebSocket/REST market ticks are now batched and flushed instead of rewriting the full `state.json` on every tick. Ledger/trade/position/settings writes remain immediate.
- Added bounded retention for high-volume operational history (`alerts`, `audit`, `setupEvents`, `handoffs`, `closePackages`, trigger events/snapshots and completed review triggers) while **never pruning executed trades or user reviews**.
- Added graceful pending-state flush on backend shutdown.
- Added live-session quote freshness. Provider-backed quotes older than 150 seconds during market hours are marked stale; total assets and cards stop pretending stale prices are current. After close, the latest provider-backed close remains valid.
- Health now reports `freshSymbols` and requires fresh active quotes for `quotesReady` while the market is open. Radar/Positions show `暫停更新` instead of continuing to display an old number as live.
- Background push payloads now carry Trigger Event / Snapshot / Close Package IDs. Tapping a GPT Review push performs the same structured-data handoff as the in-app button; tapping the nightly-ready push opens the nightly GPT handoff.
- Foreground GPT Review banners now hand off directly instead of clearing without action.
- Reduced App -> GPT clipboard duplication with type-specific payloads. Trigger review sends trigger evidence + latest comparison; nightly/radar sync sends portfolio, positions, compact radar/playbooks and pending triggers without repeating the entire backend object graph.
- Added regression coverage for stale live quotes, bounded history and batched market persistence. Backend suite: **57/57 passing**.

# v0.3.7

- Removed the v0.3.6 TWSE/TPEx whole-market mechanical discovery scanner. New-stock discovery is an AI responsibility, not an App/backend responsibility.
- Removed automatic 14:05 discovery polling, discovery REST endpoints, discovery persistence, mechanical candidate tags, and `marketDiscovery` from Close Package / Handoff payloads.
- Night selection handoff now explicitly tells GPT to use the App as authoritative portfolio/setup state, then independently research the public market, news, themes, institutional flows and price/volume for new candidates.
- Existing rolling Setup cards remain persistent across days; GPT can add newly researched symbols back through `EASON_TRADING_UPDATE_V1`.
- Migration strips v0.3.6 discovery runs/snapshots from existing state so old mechanical candidates cannot leak into future nightly selection.
- No changes to holdings, cash, trades, Fugle monitoring, Trigger Engine, or the ledger truth model.

# Changelog

- SDK57 WIP4: switched SDK57 installation to an isolated fresh npm cache on the official registry after WIP3 hit a stale-metadata ETARGET for an Expo package that is published. Expo pin advanced to 57.0.21; Expo-owned native modules are still normalized by `expo install --fix --npm` before release gates.

## 0.3.5

- Production startup no longer reruns the entire backend test suite every time. Release tests are separated into `scripts/verify-release.ps1`; normal web/mobile startup performs only fast environment + Fugle + active-quote gates.
- Added `scripts/start-mobile.ps1`: automatically detects the PC LAN IPv4 and launches Expo for a phone on the same Wi-Fi, so the mobile client no longer points at `127.0.0.1`.
- Added local API-token support to desktop/mobile launch flow; the Fugle secret remains backend-only.
- Radar GPT button now performs a real App -> GPT structured-data handoff before opening the saved stock conversation instead of merely opening the URL.
- Re-applying the exact same GPT response is idempotent; it cannot duplicate rolling setups or review triggers.
- State persistence is now atomic and keeps `state.json.bak`; a corrupt primary state recovers from the last-known-good backup instead of silently resetting the ledger.
- UI surfaces a backend-disconnected warning instead of silently continuing to show stale data as if it were current.
- No demo market or portfolio fallback was reintroduced.

## 0.3.4
- Fixed portfolio truth: total assets are now strictly `known cash + verified Fugle market value`; no cost-basis fallback and no legacy demo cash.
- Legacy demo cash is discarded unless the user explicitly edited cash or initialized the real ledger.
- Added cash-known state; total assets remain blank instead of showing a guessed number until cash and all held quotes are known.
- Added GPT -> App clipboard return path with preview/confirm/apply. GPT updates may change radar/setup/playbook/review triggers, but are blocked from holdings/cash/trades/ledger.
- App automatically detects an `EASON_TRADING_UPDATE_V1` block when returning from ChatGPT and offers to apply it.
- Fixed Windows test startup: test files run sequentially with isolated temp DBs; production migration tests no longer spawn nested Node processes.
- Preserved fixed stock ChatGPT URL; radar header can open it and import GPT results.
- Removed extra single-stock `next step` noise and simplified portfolio summary.

## 0.3.3

- Production cut: runtime no longer has any simulated market-data fallback. Missing/invalid Fugle configuration stops startup instead of launching a fake-looking App.
- Added provider-level Fugle verification at startup; health now reports verified provider state plus active/hydrated symbol counts.
- Production seed is now empty: no fake holdings, fake cash, fake watchlist, fake playbooks, or fake market prices. Legacy demo fixtures exist only when `TRADING_TEST_SEED=1`.
- Added one-time legacy-demo migration. Untouched old sample symbols are removed, while manually corrected real holdings/settings are preserved.
- Any non-Fugle market rows are dropped in production migration. Missing quotes remain unavailable rather than becoming 0.
- Candle API returns `market-data-unavailable` if Fugle is unavailable; it never generates mock candles in production.
- Holdings can now add/edit/remove a position and edit cash directly. These actions are audited ledger corrections and never create fake BUY/SELL trades.
- Removed all visible DEMO labels from the production UI. Status is now Fugle verified / connecting / unavailable only.
- Fixed `.env.local` handling for Windows PowerShell BOM edge cases; saved Fugle keys use ASCII and startup strips a BOM from env variable names if present.
- Kept the fixed stock ChatGPT conversation button visible at the top-right of Radar. Handoff remains explicit clipboard structured-data transfer + open the exact saved conversation.
- Added production-integrity regression coverage, including no-demo seed, no mock candle fallback, legacy demo purge, and add/remove/cash correction. Backend suite: **37/37 passing**.
- Mobile TS/TSX syntax parsing: **0 syntax errors**.

## 0.3.2

- Fix newly edited/added stock symbols getting real Fugle candles but no current quote after market close. Stock context and position edits now hydrate the quote immediately, even outside trading hours.
- Charts no longer inject a fake `0` current price when the quote is still syncing, preventing absurd Y-axis ranges.
- Stock detail only labels data as Fugle live when both quote and chart data are trusted.
- Restore a visible top-right `GPT 對話` setting on Radar; handoffs always open the exact saved stock conversation URL.
- Remove duplicate cost chip and hide meaningless `下一步：等待` noise.
- Manual position corrections switch the ledger from demo to manual mode without creating fake trades or changing cash.

## 0.3.1
- Rebuilt charts again for readability: strategy targets no longer stretch the Y axis, right-side label ladders/leader lines are removed, only the current price gets a right-side badge, nearby cost/invalid/breakout/review levels stay as subtle lines, and all strategy prices move to a compact strip below the chart.
- Simplified the single-stock screen: compact high/low/VWAP/RVOL strip, no rating badge, no large duplicate status cards, no manual archive button, and only 分時 / 日K / 週K remain visible to the user.
- Removed the manual position-status feature completely from the current product path. Holdings now expose **編輯** for correcting stock code, share quantity and cost basis. Market price remains Fugle-controlled and cannot be manually edited.
- Added `PATCH /v1/positions/:symbol` as an audited ledger-correction action. Corrections do not create fake BUY/SELL trades and do not change cash.
- Removed the standalone **復盤** tab. The backend still prepares Daily Close Package automatically, but the human UI only keeps 雷達 / 持股 / 通知. After close, Radar shows one useful action: nightly selection with today's actual trades + rolling pool.
- Fixed the GPT handoff design to be honest and actually usable without a live Connector. The App now fetches the full structured handoff payload, copies the authoritative App/Backend data itself to the clipboard, then opens the saved fixed stock ChatGPT conversation. The user pastes/sends that payload; GPT is no longer expected to magically resolve only a handoff ID.
- Clipboard handoff explicitly states that ChatGPT is **not directly connected to Backend yet** and that only ledger trades/positions are real executions. Trigger handoff still includes raw 1m/5m/daily OHLCV plus trigger-vs-now comparison; no screenshot is generated.
- Nightly selection handoff combines the necessary daily review with tomorrow selection, matching the real conversation flow instead of forcing a separate review workflow.
- Backend regression suite: **31/31 passing**.

## 0.3.0

- Simplified the human chart UI to **分時 / 日K / 週K**. 1m/5m remain available in the backend only for trigger snapshots and GPT structured-data review.
- Removed the manual `＋標的` button from the Radar header. Candidate discovery/addition remains backend/GPT-driven instead of asking the user to maintain the radar by hand.
- Added manual **position management status** independent of the trading ledger: `NORMAL / CAUTION / RISK / EXIT_REVIEW` (正常 / 注意 / 風險 / 準備出場).
- Holdings cards now show the current management status and a `更改狀態` action. Changing status never changes share quantity, average cost, cash, or executed trades.
- Position status changes are written into the permanent Setup Card/audit history and will be visible to close-package/GPT context.
- New BUY positions start as `NORMAL`; ledger initialization also initializes held positions as `NORMAL`; full exits clear the position-management status.
- Added backend validation so a position status cannot be assigned to a stock without an open position.
- Added regression coverage proving manual status changes do not mutate the trading ledger. Backend suite: **30/30 passing**.
- Prepared charts for phone testing by reducing the right-side strategy-label lane on narrow screens, preserving more room for the actual price/volume plot.
- Hardened version migration: first launch now imports the most recent prior `state.json` and `.env.local` exactly once, then writes a marker so later launches cannot overwrite new trades/status changes. Runtime `server/data/state.json` is no longer shipped in the source package.

## 0.2.9

- GPT Trigger handoff is now **structured-data only**. The backend does not generate or attach a chart image for GPT analysis.
- Trigger Snapshot schema v2 freezes exact trigger-time market fields plus raw **60×1m, 36×5m and 60×daily OHLCV** series.
- Removed the old `charts` snapshot field; numeric series are stored under `seriesAtTrigger` with explicit units (`TWD`, `lots`).
- Added `dataQuality` and source metadata so GPT can distinguish LIVE / STALE / ERROR / DEMO input instead of treating every payload as equally trustworthy.
- Trigger handoff retrieval now adds fresh 1m/5m structured series and the latest market snapshot at the moment the user opens the fixed stock ChatGPT conversation.
- Added trigger-vs-now comparison fields: latest price, price delta %, high/low since trigger, bars since trigger, and long-side MFE/MAE since trigger.
- Trigger-time data remains immutable; latest context is returned separately as `latestReviewData`, so later quotes never overwrite what actually caused the notification.
- App copy now states explicitly that GPT handoff reads backend numeric data rather than screenshots or generated images.

## 0.2.8

- Fixed a real Fugle volume-unit bug found on the 2337 live screen. Fugle intraday listed/OTC volume is returned in **lots**, while historical daily/weekly/monthly volume is returned in **shares**. Historical listed/OTC volume is now normalized to lots before charting or comparing with live data.
- Fixed the current daily/weekly bar being ~1000x too small versus prior historical bars when it was merged from the live quote.
- Fixed RVOL baseline math using historical shares against live lots, which could understate live RVOL by ~1000x.
- Intraday volume rendering no longer drops every second minute when downsampling the price line. Every returned 1-minute volume bucket is retained, so the volume profile matches the underlying Fugle candles.
- Removed 1px gaps between hundreds of intraday volume bars, which previously consumed much of the chart width and exaggerated sparse-looking volume.
- Added unit-normalization tests for TSE/OTC vs ESB/index data.
- Note: the 13:30 closing-auction spike can legitimately be large. For 2337 on 2026-09-07, public Yahoo data shows 2,386 lots at 13:30 out of 28,389 lots total; the fix preserves that real spike while correcting the rest of the profile.

## 0.2.7

- Rebuilt chart strategy overlays for readability after live-market validation on the 2337 detail page.
- Intraday / 1m / 5m charts now scale primarily to **actual market movement + nearby actionable levels** instead of letting far-away targets flatten the price action.
- Far strategy levels such as first-harvest / main-target are preserved as compact upper/lower edge summaries rather than stretching the chart viewport.
- Added a dedicated right-side **price-label lane**. Current price, breakout, invalidation, cost, max-entry and GPT-review labels are collision-resolved instead of drawing on top of one another.
- Strategy lines remain at their exact price while short leader lines connect them to any vertically shifted label, so spacing no longer changes the meaning of the level.
- Current price now has an explicit `現價` badge and is visually separated from nearby strategy labels.
- Candle plot and volume plot reserve the label lane, so K bars and labels no longer cover each other.
- Good-price zones are clipped to the visible viewport instead of forcing the viewport larger.
- Added pure chart-layout checks for the exact failure pattern seen in live data: 121 cost / 123 invalid / 124.5 current / 126.5 breakout with 133 and 140 distant targets.

## 0.2.6

- Reworked radar around a **persistent rolling Setup pool** instead of a disposable daily watchlist.
- Added permanent Setup Cards with discovery date, setup type, original thesis, lifecycle stage, selection validity, entry opportunity, status reason and removal reason.
- Added multi-day Setup lifecycle: `NEW_DISCOVERY -> WAIT_TRIGGER -> TRIGGERED_NO_ENTRY -> WAIT_PULLBACK / READY / RECONFIRM -> POSITION_MANAGEMENT`, plus explicit `INVALIDATED / EXPIRED / ARCHIVED` terminal paths.
- A candidate can no longer silently disappear: archival/drop actions require a concrete reason and the Setup Card remains available for later postmortem.
- Separated **selection validity** from **entry opportunity** so “picked the right stock” and “had a good buy point” are measured independently.
- Added User Hypothesis records. New user ideas start `UNCONFIRMED` and are stored separately from market evidence/playbook state until evidence supports or rejects them.
- Trigger snapshots now freeze Setup Card + user hypotheses together with market, position, playbook and chart context.
- Added automatic **Daily Close Package** after 13:40 Taipei time. The first section is authoritative executed trading: real BUY/SELLs, touched symbols, realized P&L, or explicit “no actual trades”.
- Close Packages include closing positions, Setup changes, fired triggers, new discoveries, pending GPT-review triggers, rolling-pool ranking and learning candidates.
- Close Packages remain fresh if a trade is recorded after the first package was generated.
- Added fixed stock-ChatGPT URL setting and App-to-GPT **handoff** objects.
- App buttons now support: `到股票 GPT 複判`, `到股票 GPT 復盤`, `到股票 GPT 選股`.
- A handoff copies a short instruction such as `旺宏碰到了 #ho_...` / `收盤復盤 #ho_...` / `今晚選股 #ho_...` to the clipboard and opens the user-configured fixed stock conversation.
- Added backend/API/MCP tools for Setup lifecycle, hypotheses, Close Package and handoff resolution/acknowledgement.
- Radar UI now separates immediate review, second-chance/reconfirmation, positions and continuous-waiting candidates.
- Review UI puts actual daily trades first and keeps nightly selection explicitly based on **old setups + new discoveries**, not “today’s hottest Top 5”.
- Added `expo-clipboard` for the one-tap handoff flow.
- Backend suite expanded to **26/26 passing tests**; TS/TSX transpile syntax diagnostics also pass.
- Cloudflare production adapter has not yet been brought to full v0.2.6 workflow parity; local Node backend is the reference implementation for the new Setup/Close/Handoff APIs.

## 0.2.5

- Live-data integrity pass: Fugle key present no longer makes demo seed values look live.
- Startup hydrates current/last Fugle quotes even outside trading hours.
- Added market-session status (OPEN / CLOSED / WEEKEND) in Taipei time.
- Weekly K is now aggregated locally from <1 year of daily candles to stay inside Fugle historical-range limits.
- Fugle REST calls now have a timeout instead of hanging startup indefinitely.
- Stock-detail focus is promoted into the 5 Fugle WebSocket slots; detail market context refreshes every 2 seconds from the local backend.
- Intraday/1m/5m charts update the current point/bar from the live backend context between full candle refreshes.
- Radar refreshes local backend state every 5 seconds without consuming extra Fugle REST quota.
- Added GPT Review Trigger foundation: structured ARMED -> FIRING -> FIRED lifecycle, exact trigger event, frozen snapshot, intraday + daily chart capture, and user notification event.
- Added MCP/API tools for creating/canceling review triggers and reading fired trigger snapshots.
- Added explicit one-time ledger initialization API/tool; demo holdings are now labeled DEMO until initialized.
- Added `save-fugle-key.ps1` to save a copied Fugle key locally without printing it.
- Fresh upgrades automatically import `.env.local` and `server/data/state.json` from the most recent older install, so future updates do not reset settings or trading state.
- Removed packaged `state.json`; first run uses seed only when no prior state exists.
- Backend startup tests now run against an isolated temp DB; they can no longer overwrite the user's real trading state.
- Playbook writes can no longer fake DROP/CLOSED/POSITION state changes that belong to the real trade ledger.
- Trade audit now preserves whether the authoritative record came from the user, app, or ChatGPT connector.
- Backend test suite expanded to 21 passing tests.

## 0.2.4

- Verified Fugle startup hydration and prevented silent chart fallback when a live key is configured.
- Improved Windows startup process and live-data verification.

## 0.2.3

- Split timeline from 1m/5m/daily/weekly candles.
- Added strategy overlays and chart caching/prefetch.

## 0.3.15 — GPT Action onboarding + apply acknowledgement

- Added authenticated GPT Action readiness endpoint with App heartbeat, state age and command counts.
- GPT Action strategy/undo calls can wait for the 15-second local reconcile loop and return `applied: true` when the App actually acknowledged the command.
- Added public GPT Action instruction and privacy endpoints.
- Added `scripts/setup-gpt-action.ps1` to verify the deployed bridge, detect normal-chat vs existing-custom-GPT URLs, and generate exact one-time Action setup details locally.
- Cloud setup now verifies Action readiness/OpenAPI and saves schema/instruction/privacy URLs in `.env.local`.
- Backend health exposes GPT Direct runtime sync/poll/apply/error status.
- Radar explicitly labels Direct bridge availability and demotes clipboard Sync/Apply to fallback use.
- Direct safety boundary remains strategy-only; no cash/trade/quantity/Ledger write surface was added.

### SDK57 WIP7 deterministic install proof
- Isolated preflight now emits a versioned SHA-bound proof for the exact normalized mobile package and package-lock that passed Expo Doctor, true TypeScript, Android export, and iOS export.
- Production v0.3.16 installer will require that matching proof and reproduce it with `npm ci`; it no longer re-resolves or mutates the verified dependency graph with `npm install` / `expo install --fix`.
- The proof is rejected if source ZIP SHA, package hashes, lock scope, or core SDK57 resolved versions do not match. Active v0.3.15 remains untouched until the locked graph is reproduced and reverified.
- FIX5 release tooling: corrected invalid PowerShell `for($x in ...)` syntax to `foreach($x in ...)`; generated PowerShell scripts are parser-checked before SDK57 preflight.


## v0.3.18 FINAL audit hardening

- Audited the complete market-hours Cloud push -> exact review event -> GPT -> strategy acknowledgement path and after-close package flow.
- Added exact review-event correlation, NO_CHANGE completion, completion retry, stale/holiday/trial/halt quote guards, and an exact non-mutating Cloud/Backend PING diagnostic.
- Production audit now performs command-safe sync so it never drains unrelated pending GPT strategy commands.
- Removed production Expo Go dependency and pinned Cloud Wrangler 4.131.2 plus EAS CLI 24.3.0.
- Added FINAL_AUDIT.md with pre-cutover and external acceptance gates.

## v0.3.18 FINAL-R3 build-submission hardening
- Fixed the final Windows EAS APK builder: PowerShell's automatic `$args` variable was accidentally reused as a function parameter, so `npx eas-cli@24.3.0` received no EAS subcommand and printed help while returning exit code 0.
- Final builder now invokes pinned EAS CLI commands directly, waits for the Android preview build to complete, and verifies the latest finished v0.3.18 preview build.
- Pinned legacy EAS setup/push-build helpers to 24.3.0 as well; no operational EAS script uses `@latest`.
- Release contract now rejects `$Args`/`@Args` forwarding in the Android builder and rejects drifting `eas-cli@latest` in operational scripts.
# 0.3.19

- Added a durable, authenticated Cloud transport queue for all mobile Ledger mutations.
- Added deterministic ordering, idempotent local apply records, conflict rejection, and retry-safe Cloud acknowledgement.
- Mobile add/edit/delete holding, cash corrections, and executed trades now work while the PC is off and clearly show “待同步”.
- Added D1 migration `0005_ledger_mutation_queue.sql`; Cloud remains non-authoritative and GPT remains strategy-only.
