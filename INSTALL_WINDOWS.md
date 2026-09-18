# Windows upgrade — Eason Trading v0.3.18 / Expo SDK 57

## Downloads 需要

- `eason-trading-v1-source-v0.3.18.zip`
- `Update-eason-trading-v0.3.18-SDK57.ps1`

執行：

```powershell
powershell -ExecutionPolicy Bypass -File "$env:USERPROFILE\Downloads\Update-eason-trading-v0.3.18-SDK57.ps1"
```

## Updater 做什麼

1. 用內嵌 SHA-256 找到正確 source ZIP。
2. 解析目前 active Eason Trading root。
3. 解到獨立 staging，不先動舊版。
4. 跑 source gate。
5. 用官方 npm registry 與隔離 cache 安裝 v0.3.18 dependencies。
6. 跑 Backend / Cloud tests。
7. 跑 Expo dependency check、Expo Doctor、config/plugin、TypeScript、Android/iOS export bundle gate。
8. 確認 active pointer 在 preflight 期間沒被改動。
9. 停舊 Backend，立刻備份最新 `state.json(.bak)` 與 `.env.local`。
10. 將最新 Ledger / env / EAS projectId 帶進 staging。
11. 跑 imported-Ledger smoke。
12. 啟動 v0.3.18，先驗 health / Fugle，再做 cutover。
13. 套 D1 migration、部署 Cloud Worker、同步 monitor/device/GPT bridge。
14. 全部通過後才更新 `eason-trading-current.txt`。

任一步驟失敗，active pointer 不會正式前移，且 updater 會嘗試恢復上一版 Backend。

## Rollback

```powershell
powershell -ExecutionPolicy Bypass -File "$env:USERPROFILE\Downloads\Rollback-eason-trading-v0.3.18.ps1"
```

Rollback 會先 snapshot 目前新版本的最新 Ledger，再 merge 回上一版可用狀態，避免因 rollback 把較新的成交資料倒退。

## PowerShell / Node

- Windows PowerShell 5.1 支援
- Node.js 22.13+ 必要
- Production APK 日常不需要 Expo Go / Metro
