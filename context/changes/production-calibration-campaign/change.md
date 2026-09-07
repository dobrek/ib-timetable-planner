---
change_id: production-calibration-campaign
title: Production calibration campaign
status: implementing
created: 2026-09-03
updated: 2026-09-07
archived_at: null
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

### 2026-09-04 — Cloudflare budget check: no plan change and no limit increase needed for the campaign.

Sources: developers.cloudflare.com/containers/pricing, /containers/platform-details/limits, /workers/platform/pricing, /billing/manage/budget-alerts (fetched 2026-09-04).

- **Plan.** Containers need Workers Paid ($5/month minimum), which the account already has. There is no spend cap or usage block on Workers Paid: overage is billed on the monthly invoice; nothing stops a run mid-way.
- **Included per month:** 375 vCPU-min, 25 GiB-h memory, 200 GB-h disk. **Overage:** $0.000020/vCPU-s, $0.0000025/GiB-s, $0.00000007/GB-s. CPU bills on active use only; memory and disk bill while the instance is provisioned (awake), and stop at sleep.
- **Campaign estimate (15 runs ≈ 3.8 h of solving on `standard-4` = 4 vCPU / 12 GiB / 20 GB; ≈ 8–11 h awake including sleep windows):** CPU ≈ 15 vCPU-h → ~$0.65 over the allowance; memory ≈ 100–135 GiB-h → ~$0.70–1.00; disk ≈ 170–225 GB-h → ~$0. **Total ≈ $1.5–2.5 on top of the $5 plan**; worst case with no allowance left ≈ $4.
- **Instance size.** `standard-4` is the largest predefined type; anything bigger is an account-team request. Not needed: the PRD parks off-Cloudflare unless calibration proves 4 vCPU binding, and the campaign is what decides that.
- **Account limits** (1,500 concurrent vCPU, 6 TiB memory, 50 GB image storage) are irrelevant at `max_instances: 1`.
- **GitHub Actions:** the repo is public, so the ~10 campaign merges cost no billed minutes.
- **Optional guard:** a Cloudflare *Budget alert* (Billing → Budget alerts, dollar-based) or a *Usage Based Billing* notification (Notifications → product = Workers) at e.g. $10/month is the only safety net available; it warns, it does not block.

### 2026-09-07 — Phases 1–2 landed and verified locally; Phases 3–5 are production-gated

**Phase 1 (`3735bc2`) — the knobs.** `SOLVER_STAGE_BUDGET_S` / `SOLVER_MODE_A_BUDGET_S` join
`settings.py` on the degrade-never-crash rule with `None` meaning "the engine's own default"
(`runner._with_budgets` simply does not pass a field it has no value for, so `SolveConfig`'s literals
stay the single source of truth). The startup line now names both, and prints `<engine-default>`
rather than a number when unset — the campaign needs to tell a container that was *told* 120 from one
that fell through to it. The Worker forwards nine keys instead of six: the two budgets plus
`SOLVER_STAGE_TARGETS`, pinned as `CONTAINER_STAGE_BUDGET_S = "120"`, `CONTAINER_MODE_A_BUDGET_S =
"300"`, `CONTAINER_STAGE_TARGETS = ""`. Behaviour is unchanged; the diff is plumbing plus its docs.

**Phase 2 (`968aece`) — `pnpm analyze:jobs`.** Read-only, on the `plan-quality.analyze.ts` precedent
(`ANALYZE_ALLOW_REMOTE=1` for hosted), narrow projection, both jsonb columns read through the
entity's own readers (`parseStoredStages`, `parseStoredPolicy`). Table building is pure and unit
tested in `bench/generation-jobs-report.ts`. `analyze:plans` gained a file argument too — the shared
config's `bench/**/*.analyze.ts` include would otherwise run both analyzers under either script.

**Local end-to-end proof of the budget knob (not a production measurement).** Solver started with
`SOLVER_STAGE_BUDGET_S=5`; its startup line read `stage_budget_s=5 mode_a_budget_s=<engine-default>`.
Generate on the local `Seed Plan A` through the built preview (job `bfd13cae…`) produced a complete
delivered board in 39 s, and every budget-stopped stage reported `wallClockS` between 5.03 and 5.06:

| tier | name | status | best | wallClockS | stoppedBy |
|---|---|---|---|---|---|
| 1 | completeness | OPTIMAL | 0 | 0.45 | — |
| 2 | holes | OPTIMAL | 0 | 2.56 | — |
| 3 | totalSlots | FEASIBLE | 99 | 5.06 | budget |
| 4 | teacherHoles | FEASIBLE | 232 | 5.04 | budget |
| 5 | softHits | OPTIMAL | 0 | 2.63 | — |
| 6 | studentHoles | FEASIBLE | 1277 | 5.03 | budget |
| 7 | doublesDeficit | FEASIBLE | 328 | 5.03 | budget |
| 8 | lateStarts | OPTIMAL | 0 | 2.30 | — |
| 9 | fridayTail | FEASIBLE | 40 | 5.03 | budget |
| 10 | goldenBandDistance | FEASIBLE | 18 | 5.06 | budget |

The control is job `0b82bb95…` on the same local catalog at the engine default, where tiers 3/4/6/9/10
report `wallClockS` 120.02–120.18. **These are M-series numbers and may never become a container's
budget** — they prove the knob's path, nothing about what should ship.

**What remains, and why it cannot be done from a workstation.** Phases 3–5 are production
operations: a deploy-during-solve drill on the deployed container, the `sleepAfter: 10m` renewal
proof, twelve serial ~15–25 minute production solves with a Worker-only merge between cells, and then
the shipped constants, UI ceiling, `rollout_active_grace_period` and prose that those measurements
defend. Each needs a merge to `main` (every merge deploys), `wrangler tail` on the live container, and
a real hosted plan to clone. The plan's own estimate is ~3–4 hours of serial solving spread over
several days. Nothing in Phase 5 can be written honestly before the ledger exists — that is the point
of the slice.
