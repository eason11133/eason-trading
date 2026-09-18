# $0 Cloud Monitor deployment — v0.3.14

The Cloudflare layer is **monitor-only**. It is not a second trading backend and it never stores the user's portfolio ledger.

## What D1 may contain
- armed GPT review targets
- the trigger's structured conditions
- a minimal Playbook / Setup monitor context
- fired trigger snapshots and review status
- Expo device tokens and the fixed stock-ChatGPT URL needed for notification handoff

## What D1 must never contain
- cash
- positions / quantities / average cost
- executed trades
- realized P/L ledger
- full portfolio
- demo holdings or demo market data

## One-time setup
From the project root on Windows:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup-cloud-monitor.ps1
```

The script:
1. reuses the real Fugle key already stored in `.env.local`;
2. generates a separate Cloud Monitor API token;
3. signs into Cloudflare through Wrangler if needed;
4. creates/reuses D1 `eason-trading-monitor`;
5. applies the monitor-only migration;
6. uploads Worker secrets;
7. deploys the Worker to workers.dev;
8. stores the final Worker URL back into `.env.local`;
9. health-checks that the deployed Worker reports `monitorOnly: true`;
10. syncs currently armed triggers if the local Backend is running.

The generated `cloudflare/wrangler.toml`, `.env.local`, D1 state and Cloudflare credentials are runtime/user files and are never shipped inside the cumulative source ZIP.


## Pair the standalone app

After installing the EAS preview/standalone build, the Backend address is not permanently compiled into the app. While the PC Backend is running:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\pair-mobile.ps1
```

Enter the printed LAN Backend URL and 6-digit one-time code in the app. The API token is stored in SecureStore. Open the paired app once while the PC is online so its Expo Push token reaches the local Backend and then Cloud sync.

Cloud `/health` reports `enabledDevices`; zero means monitoring may be deployed but no phone can receive remote Push yet.

## Test Push without waiting for a stock trigger

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\test-cloud-push.ps1
```

This calls a protected Cloud test-only endpoint. The notification clearly says it is a test, contains no GPT handoff URL, and does **not** create or fire any trading Trigger.

## PC-off behavior
When the local PC is unavailable, the Worker checks only already-armed GPT review conditions. A match freezes a Fugle REST snapshot, stores a Cloud Event and sends an Expo push notification. The push contains a one-event opaque handoff URL; the phone can fetch that single event without exposing the general Cloud API key.

When the local Backend returns, it reconciles Cloud Events back into the normal GPT Review Inbox and marks the corresponding local trigger FIRED. A GPT update that carries `cloudEventId` completes the local Inbox event and the Cloud Event together.

## Mobile push prerequisite
Cloud monitoring can run without the PC, but remote push also requires the mobile app to have a valid Expo/EAS project ID and a push-capable build. Run:

Before a local Android build, copy `mobile/google-services.json.example` to
`mobile/google-services.json` and replace every placeholder with the Firebase
Android client configuration for `com.eason.trading`. The real file is ignored
by Git and must never be committed.

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup-expo-push.ps1
```

This links the project with EAS and writes `extra.eas.projectId` into `mobile/app.json`. The installer must preserve this user-specific project ID on later upgrades.

Do not treat Expo Go as the final PC-off runtime. A push-capable development/standalone build is required for a dependable cold-start notification flow on platforms where Expo Go does not support remote push.

## Push-capable phone build for the real PC-off test
After `setup-expo-push.ps1` has written the EAS project ID, build the internal preview app:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build-mobile-push-test.ps1 -Platform android
```

Use `-Platform ios` when testing iOS. This build step is intentionally separate from Cloudflare deployment because it needs the user's Expo/EAS account and platform credentials.

After installing that preview build, open it once while the local Backend is available. The Notifications page must show that remote push is registered. If the Cloud Monitor is configured, the same page also shows `ready / armed` Trigger counts. Any RVOL Trigger missing a daily-volume baseline is shown as not ready for PC-off backup instead of being silently treated as monitored.
