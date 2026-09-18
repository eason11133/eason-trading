# Eason Trading V1

## Product contract
- ChatGPT is the primary command/reasoning surface.
- The mobile/web app has no AI chat UI.
- Trading Backend is the source of truth.
- Real trades only change after explicit user execution/recording.
- Playbooks can be revised by the ChatGPT connector, but cannot fake ledger changes.
- Monitoring is layered: broad lower-frequency radar + up to 5 high-frequency Fugle focus slots.
- V1 monthly incremental cost target: NT$0.

## Interaction contract
The normal loop is:

`conversation -> structured trigger -> backend monitors -> freeze snapshot -> user notification -> App copies structured trigger data + opens fixed stock ChatGPT conversation -> user pastes -> GPT analyzes -> decision -> next trigger`

Screenshots are an exception, not a normal prerequisite.

## Persistent Setup model
The radar is a rolling multi-day Setup pool, not a fresh list generated each night. A candidate persists until there is an explicit lifecycle reason to archive/invalidate/expire it.

Setup stages:
- `NEW_DISCOVERY`
- `WAIT_TRIGGER`
- `TRIGGERED_NO_ENTRY`
- `WAIT_PULLBACK`
- `READY`
- `RECONFIRM`
- `LOW_PRIORITY`
- `POSITION_MANAGEMENT`
- `CLOSED_POSITION`
- `INVALIDATED`
- `EXPIRED`
- `ARCHIVED`

Two independent review axes are preserved:
- **Selection Validity**: was the stock/setup thesis actually right?
- **Entry Opportunity**: was there actually a good entry that fit the strategy?

User ideas are stored as **User Hypotheses** and start `UNCONFIRMED`; they do not become market evidence just because the user suggested them.

## Daily close / nightly selection
After the close, the backend prepares a Daily Close Package with actual executed trades first, then closing holdings, setup changes, fired triggers, reviews, discoveries and the rolling candidate pool.

Nightly selection is currently a user-initiated handoff into the fixed stock ChatGPT conversation. GPT should compare old setups with new discoveries over the next 5–10 trading days instead of ranking only the hottest same-day stocks.

## App navigation
1. 雷達 — rolling Setup pool, immediate reviews, second-chance setups and held positions.
2. 持股 — authoritative positions and risk/harvest management.
3. 通知 — deduped state-change events and structured GPT Review handoff.

Daily Close Package / review history stay in Backend. The App no longer dedicates a fourth tab to them; after close, Radar exposes the nightly-selection handoff when useful.

Single-stock detail is a drill-down, not a bottom tab. It includes current price, chart modes, volume, strategy overlays, permanent Setup Card, separate User Hypotheses and the next action.


## GPT Trigger transfer integrity (v0.2.9)

Normal GPT review is data-only: the backend freezes exact trigger-time market values and raw 1m/5m/daily OHLCV. The app chart is for the human user only and is not used as GPT evidence. A later handoff returns trigger-time data and latest market data separately so the original trigger cannot be overwritten. Screenshots are exception-only for information outside the backend.
