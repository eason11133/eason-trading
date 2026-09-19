# Engineering story

Eason Trading began with a practical frustration. I already used Yahoo Finance to inspect charts and GPT to discuss strategy, but the workflow disappeared between conversations. A useful plan could be written in chat and then forgotten; an important market condition could happen while my computer was off; and copying numbers among tools made it difficult to know which state was current.

My first instinct was to connect everything directly. That quickly exposed the real problem: connectivity was not the hardest part. The hard part was deciding which component was allowed to own which truth.

## From an app to a system of boundaries

I made the local backend the only authority for the financial Ledger. Cash, executed trades, quantities, and cost basis remain local. Cloudflare can monitor while the PC is off, but its state is deliberately reconstructable: rules, event snapshots, devices, and strategy-command status. GPT receives enough position and strategy context to reason, but it cannot record an order or change cash.

This separation shaped nearly every later decision. It prevented the cloud database from becoming an accidental second portfolio, and it meant that an AI response could be useful without being trusted as a transaction.

## Turning prose into deterministic behavior

A sentence such as “review this if price holds above the level with volume” sounds clear to a person but is incomplete for software. I had to define measurable fields, operators, whether all or any conditions apply, how many consecutive samples count as “holds,” when cooldown begins, and how a reusable trigger becomes eligible again.

I implemented those rules as a small state machine shared by the local backend and Cloudflare Worker. This was a turning point: cloud backup monitoring stopped being a similar implementation and became the same semantics in another runtime. The focused tests cover transitions, invalidation, cooldown, one-shot behavior, reusable exit/re-entry, and strategy-version changes.

## Preserving the reason an alert fired

Another issue appeared after triggers worked: live data changes. If an alert opens a conversation several minutes later, “current state” may no longer explain why the alert existed. The system therefore freezes a snapshot and assigns an exact review-event identity at fire time. That identity follows the notification, handoff, GPT review, strategy update or no-change decision, and completion status.

This made the workflow more than a notification system. It became an evidence trail that can answer: what happened, which version of the plan was active, what GPT reviewed, and whether the resulting strategy was actually applied.

## Designing for disconnection and retries

The PC can be offline, mobile delivery can repeat, and a Worker request can be retried. I treated these as normal operating conditions. Commands remain `PENDING` until the backend returns. Duplicate strategy bodies are detected by normalized hashes. Event imports are idempotent, statuses move forward, and completion sync can retry.

One lesson was that “exactly once” is usually the wrong promise across networks. A better design accepts at-least-once delivery and makes every meaningful operation safe to repeat.

## Verification without risking real data

Because this project contains a real personal Ledger, tests cannot casually point at the installed runtime. The release verifier starts the backend with temporary seeded state, scans the backend and Worker test suites, and checks release contracts and package cleanliness. A separate production audit requires an explicit mode, prevents pending strategy commands from being applied during the audit, sends only a non-trading bridge probe, and fingerprints the Ledger before and after.

I also learned that release engineering is part of the product. Ignore rules, secret examples, installer cutover, rollback metadata, Android build configuration, and clean-source publication all affect whether a project is trustworthy.

## What the project demonstrates

- Translating informal strategy into deterministic state transitions.
- Distributing one rule engine across local and edge runtimes.
- Defining explicit ownership for sensitive data.
- Correlating asynchronous events without duplication.
- Constraining AI authority in schemas and validators.
- Testing source behavior without touching the user's real state.
- Refining the mobile interface around the few decisions that matter now.

If I continued the project, I would expand observability around long-running reconciliation, add property-based tests for more trigger combinations, and build a reproducible visual-regression set across Android screen sizes. The current FINAL-R3 baseline is intentionally conservative: it favors traceability, safe recovery, and clear authority over pretending that every external dependency is always online.
