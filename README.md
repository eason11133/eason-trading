# Eason Trading v0.3.18

Eason Trading 不是第二個 Yahoo 股市。它只負責三件事：**記住 GPT 的策略、盤中安靜監控、收盤後把完整資料交給 GPT 復盤**。

## 真正使用方式

### 盤中

平常不用開 App。看盤仍用 Yahoo，判斷仍跟 GPT 討論。

Eason Trading 會在本機／Cloud 監控 GPT 留下的結構化條件。通知不是單純「碰到價格」就發，而是經過安全的 smart-trigger 規則判斷，例如：

- 進入 GPT 定義的價格區間
- invalidation 尚未成立
- RVOL / VWAP / 漲跌幅 / 高低點條件符合
- 條件連續成立指定次數
- 狀態真的從不符合轉成符合
- cooldown / one-shot 規則允許

同一狀態下重複 tick 不會一直洗通知。Setup 已失效時，進場型提醒不會再發。

通知會保存「為什麼這次值得重新判斷」的 evidence。點通知後，Cloud event 會先標記成 GPT_SENT，再開使用者設定的股票 GPT 對話；GPT Action 可直接讀取該事件，不需要截圖或手動貼 JSON。

### 收盤後

這才是主要打開 App 的時間。

首頁會顯示當日資料是否已整理，主要按鈕只有：

**交給 GPT 復盤**

App 會先重新產生當日 close package，再建立 handoff、同步 GPT bridge，然後開 GPT。Close package 會整理系統真正擁有的資料，例如持股狀態、收盤行情、監控策略、今日 Trigger、失效／複判狀態；未知資料會保留為 unknown，不會自行補值。

GPT 若修改策略，正常流程是 Action → Cloud command → Backend reconcile → App Diff / apply。Raw `EASON_TRADING_UPDATE_V1` 只保留為 Direct Action 真正失敗時的 fallback。

## 資料邊界

Local Ledger 永遠是唯一真實帳本。

Cloudflare 只保存可重建的 monitor / event / GPT strategy bridge 狀態，不是第二份 Ledger。GPT 不能透過遠端工具修改：

- 現金
- 成交紀錄
- 持股數量
- Ledger truth

GPT 可以更新的是策略、setup、playbook、review trigger 等非帳本資料。

## 手機 UI

v0.3.18 把主畫面收斂成 event-driven：

- 盤中沒事：`目前沒有需要處理的事`
- 有意義事件：優先顯示一件「值得重新判斷」與原因
- 收盤後：`今日資料已整理` + `交給 GPT 復盤`
- `持股`、`監控策略`、系統狀態都移到次級入口

分時與 K 線維持原生 SVG 向量繪製，不使用放大的 raster 圖。

## 日常啟動

已安裝 Android APK 後不需要 Expo Go。

Windows 開 Backend：

```powershell
powershell -ExecutionPolicy Bypass -File ".\scripts\start-backend.ps1"
```

它會檢查 Node、Fugle、Backend health，並同步 Cloud targets / device / GPT bridge。需要重新配對手機時才產生 pairing code。

## v0.3.18 升級

請使用正式 updater，不要手動覆蓋資料夾：

```powershell
powershell -ExecutionPolicy Bypass -File "$env:USERPROFILE\Downloads\Update-eason-trading-v0.3.18-SDK57.ps1"
```

Updater 會先在 staging 安裝依賴與跑完整 gate，舊版保持在線；只有新版本 local + Cloud 驗證成功後才更新 `eason-trading-current.txt`。失敗時舊 baseline 保持可回復。

## Custom GPT Action

Cloud Worker 提供：

- `/gpt-action-openapi.json`
- `/gpt-action-instructions.txt`

如果你的 Custom GPT 是在 v0.3.18 之前匯入 Action schema，GPT Builder 不會自動刷新已保存的 schema。要使用 v0.3.18 新增的 optional trigger policy 欄位時，需要在 GPT Builder **重新匯入一次**新版 OpenAPI；這是 ChatGPT 設定面的限制，不是 App runtime 能自動修改的設定。
