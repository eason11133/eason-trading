# Cloud setup launcher hotfix WIP1 (historical)

> Historical v0.3.15 recovery note retained for release archaeology. It is not the current FINAL-R3 setup guide; use [FREE_DEPLOYMENT.md](FREE_DEPLOYMENT.md) for v0.3.18.

This snapshot remains runtime version 0.3.15. It changes only `scripts/setup-cloud-monitor.ps1`.

Windows Cloudflare setup no longer invokes Wrangler through `npx`. After local `npm install`, the script reads `cloudflare/node_modules/wrangler/package.json`, resolves Wrangler's actual JS `bin`, and launches it with the active `node.exe` for whoami/login/D1/secrets/deploy.

The release contract rejects future `npx wrangler` usage in this setup script.

Do not install this snapshot as an App release. Use the standalone hotfix script against the already-installed v0.3.15 baseline.
