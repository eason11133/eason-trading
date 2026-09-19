# Eason Trading v0.3.16 UI1 (historical design note)

> Retained as design history. The current production source baseline is v0.3.18 FINAL-R3.

Scope: presentation and information hierarchy only.

## Radar
- Compact market/GPT/Push/Cloud status chips.
- Keep immediate review counts and actionable candidates above secondary information.
- Compress the nightly selection handoff into a one-line action row.
- Only show second-opportunity, holdings, and other-observation sections when they contain data.

## Holdings
- Merge incomplete brokerage/cash setup into one setup panel.
- Make total assets the primary value, with market value and cash secondary.
- Keep P&L cards compact; historical-cost limitations are available on tap rather than as a long paragraph.

## Notifications
- Compact Push/Cloud/Trigger readiness summary.
- Keep pending GPT reviews first.
- Separate risk/hot alerts from low-priority history records.

## Safety boundary
No API signatures, GPT handoff/update behavior, trigger rules, ledger calculations, cloud worker behavior, or trading logic were changed.
