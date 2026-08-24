---
change_id: job-aware-container-lifecycle
title: Job-aware container lifecycle
status: implementing
created: 2026-08-20
updated: 2026-08-24
archived_at: null
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

- Roadmap slice **S-304** (`context/foundation/roadmap.md:152-179`), PRD **FR-311**. Prerequisites S-302 + S-303 are both `done`, so the slice is unblocked.
- Feasibility research: `research.md` (2026-08-20). Verdict **feasible**; the schema, grants, contract enum and stop seam were all pre-paid by F-301 and S-303, and the one API the design turns on (`renewActivityTimeout()`) exists in the installed SDK.
- Two roadmap/PRD claims were falsified during research and need truing up as part of this change — see research.md § "Corrections owed to in-repo prose".

### Tier-1 drill, 2026-08-24 (phases 1–2)

Local stack + `mise run solver:dev`, the committed golden `SolveRequest` (a full-length solve)
dispatched to a hand-seeded `generation_jobs` row. SIGTERM sent directly to uvicorn rather than
Ctrl-C — the same first-signal lifespan path, and it sidesteps the double-tap that sets `force_exit`.

**Heartbeat (1.5).** Claim at `10:02:05.251`; the heartbeat client's own (lazy) password grant at
`10:02:20.401`. `heartbeat_at` then advanced at `08:02:20.402 → 08:02:35.417 → 08:02:50.431` UTC —
**15.015 s / 15.014 s** — while `stage_index` stayed 3 and `stages` stayed length 2, i.e. the
renewals happened strictly *between* stage events, which is exactly what S-303's cadence could not do.

**SIGTERM (2.3).** Sent `10:03:10.3`. Log:

```
shutdown: asked 1 solve(s) to stop; waiting up to 120s for their terminal writes
job … interrupted: outcome=complete after 4 stage(s)
shutdown: every solve wrote its terminal row in 1.5s
```

Row: `status=interrupted`, `stages` length 4, `checkpoint_stage_index=4`, `checkpoint` non-null,
`result` NULL, `error` naming stage 4 (`teacherHoles`). Process exited ~2 s after the signal —
against a 120 s join budget and the platform's 15-minute window.

`outcome=complete` in that log line is F1's hole reproduced live: the cancelled Mode-A run really
does return `complete`, so the pre-S-304 outcome branch would have written **`succeeded`** over an
interrupted solve. The latch is what caught it.
