# Zero-cost market monitoring design

V1 treats free-data limits as a scheduling problem, not a product watchlist limit.

## Layers
- **Focus slots (max 5):** highest-priority positions/candidates use Fugle WebSocket `aggregates` while the live focus connection is active.
- **Broad radar:** all remaining active symbols rotate through REST quote calls.
- **Promotion:** priority determines the current Top 5; future scoring can promote a mover automatically.
- **No paid auto-upgrade:** if a free limit is approached, scan frequency drops.

## RVOL
A raw cumulative volume number is not enough. V1 stores a 5-session average daily volume baseline and computes:

`RVOL = current cumulative volume / (5-day avg daily volume × elapsed-session fraction)`

This avoids treating normal early-session volume as weak merely because the day is not finished.

Baselines are refreshed gradually (at most one historical request per scan cycle) so the radar does not burn the REST quota at startup.

## Time budget
- Broad market scanning only runs around Taiwan market hours.
- Night / weekend quote polling is disabled.
- Official disclosure polling can continue during a wider daytime window.

## News / disclosures
V1 includes official TWSE / TPEx daily material-disclosure feeds for active watchlist symbols. These are source-cadence events, not guaranteed second-level newswire delivery. On first boot, only recent disclosures are promoted to notifications to avoid old same-day items flooding the inbox.
