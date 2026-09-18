# Eason Trading v0.3.18 — quiet monitor + after-close GPT bridge

## Release focus

v0.3.18 不再把 App 當成盤中主要行情介面。產品主線固定為：

- 盤中：smart monitor 靜默運作，只在條件具有決策意義時通知。
- 通知：保存 trigger evidence，讓 GPT 能讀到當下 snapshot + 原策略 + 觸發原因。
- 收盤後：App 一鍵產生今日 close package 並交給 GPT 復盤。
- GPT strategy update 走 Direct Action / Cloud command / Backend reconcile / App Diff。
- Yahoo 繼續負責看圖、新聞與市場瀏覽。

## Smart trigger

Local Backend 與 Cloud Worker 共用相同 evaluator：

- `all` / `any` predicate
- explicit `invalidation`
- playbook invalidation precedence
- setup/playbook version check
- `minConsecutive`
- `cooldownMinutes`
- `oneShot`
- false→true transition semantics
- repeated-tick dedupe
- reusable leave/re-enter semantics
- decision evidence persisted with event

Cloud migration `0004_smart_trigger_runtime.sql` 保存每個 target 的 trigger runtime，使 PC-off 監控和本機語意一致。

## Mobile

- 首頁改為 market-hours / after-close 兩態。
- Holdings / monitoring / system status 降成次級入口。
- Android production app 不再 fallback 到 `127.0.0.1`。
- 未配對與 Backend 暫時離線有不同、較不驚嚇的 UI。
- 盤中無 Backend 時用 Taipei local clock 判斷首頁狀態。
- Intraday / Candle chart 使用 responsive `react-native-svg` vector rendering。
- Android `versionCode=318`，iOS `buildNumber=318`。

## Release safety

- Local Ledger 仍是唯一真實帳本。
- Cloud monitor/event/GPT bridge 不保存可寫 cash/trade/holding quantity。
- GPT Ledger mutation 仍被拒絕。
- v0.3.18 updater 是 in-SDK57 upgrade：先 staging 全驗，再停舊版取最新 Ledger，再 local/cloud live smoke，最後才切 pointer。
- rollback 會先保存新版本最新 Ledger。

## Verification split

可在 clean source 離線執行的 Backend / Cloud / smart-trigger / static release contracts會在 release 打包前完成。

Expo dependency resolution、Expo Doctor、TypeScript 6、Android/iOS bundles 需要完整 npm dependency tree；正式 updater 會在使用者 Windows 機器、promotion **之前**執行這些 gate。

EAS APK build 需要使用者既有的 Expo/EAS 登入狀態與 EAS project，因此由 `scripts/build-android-apk.ps1` 在該機器執行。
