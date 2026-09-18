# Eason Trading v0.3.18 — Start here

## 1. 升級

把下列兩個檔案放在 Downloads：

- `eason-trading-v1-source-v0.3.18.zip`
- `Update-eason-trading-v0.3.18-SDK57.ps1`

然後執行：

```powershell
powershell -ExecutionPolicy Bypass -File "$env:USERPROFILE\Downloads\Update-eason-trading-v0.3.18-SDK57.ps1"
```

Updater 會自行驗 SHA、staging、npm、Backend tests、Cloud tests、Expo check、Doctor、TypeScript、Android/iOS bundles、imported Ledger、Cloud migration/deploy/sync，通過後才切 active pointer。

## 2. 平常使用

Installed APK 不需要 Expo Go。

電腦要開本機 Backend 時：

```powershell
$root = (Get-Content "$env:USERPROFILE\Downloads\eason-trading-current.txt" -Raw).Trim()
powershell -ExecutionPolicy Bypass -File "$root\scripts\start-backend.ps1"
```

盤中 Eason Trading 主要在背景／Cloud 監控，不需要一直打開。

收盤後打開 App，按 **交給 GPT 復盤**。

## 3. 如果手機尚未配對

`start-backend.ps1` 預設會顯示 LAN Backend URL 與一次性 pairing code。手機點「尚未連接電腦」後填入即可。

Android production app 不會把 `127.0.0.1` 當成電腦 Backend。

## 4. 建 Android APK

更新完成後如要產新的 EAS APK：

```powershell
$root = (Get-Content "$env:USERPROFILE\Downloads\eason-trading-current.txt" -Raw).Trim()
powershell -ExecutionPolicy Bypass -File "$root\scripts\build-android-apk.ps1"
```

這會使用已連結的 Expo/EAS project 與 EAS managed keystore，不需要 Android Studio。
