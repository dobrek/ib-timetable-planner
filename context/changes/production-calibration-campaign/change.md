---
change_id: production-calibration-campaign
title: Production calibration campaign
status: impl_reviewed
created: 2026-09-03
updated: 2026-10-07
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

### 2026-10-06 — The deploy-during-solve drill: the deploy did not interrupt the solve

The drill (`mise run solver:campaign -- drill`) ran against campaign plan `cdde43fa…` ("Calibration —
prod-calibration", cloned with its board from `3ecaea22…`, 246 h to place) under the 240 s cell
(`w4-s240-a300`). It deployed an image-changing marker (`a441f07`, a comment in
`cpsat_service/__init__.py`) from the laptop while the solve was at checkpoint position 3. The solve
was expected to end `interrupted` with its checkpoint. It ended `succeeded`, so the drill halted at
step 4 by design.

Timeline (UTC), from the Workers Observability logs, `wrangler containers info`/`instances` and the
journal:

| Time     | Event                                                                                                                       |
| -------- | --------------------------------------------------------------------------------------------------------------------------- |
| 07:15:33 | Container cold start, `stage_budget_s=240 mode_a_budget_s=300 workers=4`; job `7ef1ad6b…` starts solving                    |
| 07:20:06 | Checkpoint at ladder position 3; the drill commits the marker and starts `wrangler deploy`                                  |
| 07:21:05 | Durable Object log: "Durable Object reset because its code was updated" (twice)                                             |
| 07:21:08 | Container application registers version 19, a new image (`sha256:28192d61…`)                                               |
| 07:21:16 | Worker version `0716acac…` → `7ad4d49d…`                                                                                    |
| 07:21–07:43 | No shutdown request reaches the container: no SIGTERM, no `shutdown:` line; progress writes continue every 15 s          |
| 07:43:55 | `job 7ef1ad6b… succeeded with 246 placements` (a complete board)                                                            |
| 07:51:06 | "Activity expired, signalling container to stop", then `idle at sleepAfter`; the container logs `shutdown: no solve in flight`, exit 0 |
| 07:51:07 | The old instance is gone; a new instance on the new image waits, `inactive`, for the next start                              |

What this shows, from one observation:

- **The rollout let the running container finish on the old image.** It replaced the container only
  after the container stopped on its own. `rollout_active_grace_period` is 1200 s. Read from the
  container's start, it ended at 07:35:33; read from the deploy, at 07:41:08. The solve ran past both
  and was not touched. README's current reading ("measured from connection start, so a cold-started
  20-minute solve loses its protection") predicts a kill this run did not see.
- **A deploy resets the Durable Object, and with it the `sleepAfter` timer.** The 07:51:06 idle stop
  is 30 min 1 s after the 07:21:05 reset. It is not 30 min after the dispatch (07:15:34) or after the
  solve's end (07:43:55).
- **The rescue path is still unproven in production.** That path is SIGTERM → checkpoint →
  `interrupted` row → proposal delivers the kept board → self-heal. Nothing sent a shutdown signal,
  so none of it ran. A deploy is apparently not a reliable trigger for it.
- **One observation, not a guarantee.** Cloudflare still does not guarantee how long any instance
  runs, so this does not by itself retire README's no-merge-during-a-solve rule.

Decision: record this result and move on to `sleepAfter = "10m"` and the renewal proof. The drill's
Phase 3 criterion ("a deploy during a production solve has been watched to interrupt, checkpoint,
deliver the partial board, and self-heal") is **not met**. It stays open as a follow-up that needs a
different way to deliver a shutdown signal mid-solve. The drill's later steps did not run, so:

- its proposal (`14690fe7…`) is undelivered: the next `run`/`renewal` delivers and records it first;
- Cell C run 1 comes from the ordinary grid instead of the self-heal;
- "does a secret change disturb a running solve" was not observed, so the runner keeps parking only
  when nothing is solving.

The drill solve also stands as a full 240 s production solve: dispatched 07:15:34, succeeded
07:43:55, 246 placements. The override was parked at 08:28:56, and the marker was pushed to `main`
afterwards so `main` matches what is deployed.

### 2026-10-06 — Renewal proof at `sleepAfter = "10m"`: renewal holds; the five production numbers

`sleepAfter = "10m"` shipped in #133 (`1315822`, Deploy green). `mise run solver:campaign -- renewal`
then ran Cell A run 1 (`w4-s120-a300`, job `56f587e0…`) and read only the logs until the idle
container stopped. Its verdict was "renewal proven: a declined sleep during the solve, a succeeded
row, then idle and stopped". Cell A run 1 counts in the grid.

**Production lifecycle numbers — recorded 2026-10-06** (renewal job `56f587e0-62a3-494b-b991-928e08e43637`, drill job `7ef1ad6b-025c-454e-9d3b-becf68751811`)

| number                                         | value                                                      |
| ---------------------------------------------- | ---------------------------------------------------------- |
| cold start (`started_at − created_at`)         | 4.4 s (startup line: 3.6 s)                                |
| renewal cadence (gaps between `sleep declined`) | — (fewer than two lines)                                   |
| idle-sleep boundary (after the last request)   | idle 600.1 s, stopped 600.5 s                              |
| SIGTERM → `interrupted`                        | terminal write —; SIGTERM line → `finished_at` —           |
| drill duration, stage reached                  | 28.36 min, 10 stage(s), checkpoint at position —           |

Observed `unaccounted` per counted run (for `OVERHEAD_ALLOWANCE_S`): `7ef1ad6b` 2.866 s, `56f587e0` 2.958 s

How to read the gaps:

- **Renewal cadence "—"** is a measurement limit, not a failure. The solve ran between 10 and 20
  minutes, so it crossed one expiry and produced one `sleep declined` line. A cadence needs two.
- **SIGTERM → `interrupted` "—"** follows from the drill entry above: no shutdown signal reached a
  solve, so there was nothing to time. It stays open with the drill's follow-up.
- **Drill "checkpoint at position —"**: the drill solve ended `succeeded`, so its row holds a final
  board rather than a kept checkpoint. Its checkpoint reached position 3 before the deploy, per the
  journal.

### 2026-10-07 — Calibration passed (FR-314): 240 s stages, 60 s Mode A, 4 workers — verdict and pinned baseline

The grid finished on 2026-10-07 with **13 counted runs and none excluded**. The clean-mode fallback
never fired. Every run solved the campaign plan `cdde43fa…`, a fill-the-gaps snapshot: it was cloned
with its board from `3ecaea22…` and had 246 h to place. The record is this folder's `ledger.json`
(ids and numbers only).

**Shipped configuration** (`src/solver-container-env.ts`): `CONTAINER_STAGE_BUDGET_S = "240"`,
`CONTAINER_MODE_A_BUDGET_S = "60"`, `CONTAINER_WORKERS = "4"`. `CONTAINER_STAGE_TARGETS` stays `""`,
deferred to PRD Open Question 2.

The worst case is 2 × 60 s of Mode A (the clean fallback can run it twice) plus 9 × 240 s, which is
2280 s. That number feeds two places: the UI's `LADDER_CEILING_MINUTES = 38` ("up to about 38
minutes") and `wrangler.jsonc`'s `rollout_active_grace_period = 2280`.

**The cells, as delivered boards.** The matrix's "best" is a tier's value when its own stage ended.
Later stages may lower an earlier tier further, so the verdict reads the **delivered** objective.
The cost estimate is per median run, at the 2026-09-04 pricing in this file (4 vCPU busy, 12 GiB and
20 GB billed while awake), and includes the 10 idle minutes after a solve.

| Cell                    | Runs | Delivered total slots | Median teacher holes (delivered) | End-to-end, min       | Est. cost per Generate |
| ----------------------- | ---- | --------------------- | -------------------------------- | --------------------- | ---------------------- |
| B `w4-s60-a300`         | 3    | 94, 95, 95            | 115                              | 7.34 / 7.34 / 7.35    | ~$0.07                 |
| A `w4-s120-a300`        | 3    | 93, 94, 96            | 102                              | 10.84 / 12.10 / 14.35 | ~$0.10                 |
| C `w4-s240-a300`        | 4    | 93, 93, 93, 95        | 86                               | 21.91 / 28.36 / 28.36 | ~$0.21                 |
| D `w4-s480-a300`        | 3    | 92, 94, 94            | 70                               | 48.22 / 48.57 / 56.35 | ~$0.34                 |

Cell C's four runs include the drill solve (`7ef1ad6b…`), which ran under the same cell and counts.

**Verdict, against the plan's Phase 4 questions:**

- **Does `best` improve with budget beyond run-to-run variance?** It depends on the tier.
  - **Tier 3 (total slots) is driven more by search luck than by budget.** No cell's typical value
    beat 240 s, which delivered 93 in 3 of 4 runs. 480 s found the only 92, once, and delivered 94
    in the other two runs.
  - **Tier 4 (teacher holes) improves steadily:** 115 → 102 → 86 → 70 (delivered medians).
  - **Tiers 5–10 do not compare across cells**, because each one is solved under the values the
    tiers above it hardened.
- **Which tiers reach OPTIMAL, at which budget?**
  - Tiers 1, 2 and 5 reach it in every run at every budget, in 3.2–7.2 s.
  - Tiers 7 and 8 reach it only sometimes, with no budget trend: 120 s 2 of 3 each; 240 s 1 of 4
    each; 480 s tier 7 1 of 3 and tier 8 2 of 3.
  - Tiers 3, 4, 6, 9 and 10 never reach it: they stop on budget at every budget up to 480 s.
    Tier 3's proven bound (21–49) is too weak to say how far from optimal 92–93 is.
- **Do 8 workers on 4 vCPU help?** Not measured. Cell D was spent on 480 s × 4 workers instead,
  by the author's decision on 2026-10-07, because a free slot mattered more than the worker
  question. The shipped value stays 4, the count the container was sized for.
- **What does Mode A need?** It ran **hint-free** in every run. The app sends no `warmStart`, so the
  greedy hint is empty (`runner.py`'s request-to-dump step). Tier 1 took 3.18–4.12 s (median 3.54 s)
  across all 13 runs, so 60 s is about 15× the maximum. This is S-309's "hint-free Mode A measured"
  precondition, measured on a fill-the-gaps snapshot. A full-catalog Mode A was not measured here.
- **Did the clean fallback fire?** Never, in 13 runs.
- **Why 240 s ships:**
  - Tier 3 ranks first, and 240 s gave the most reliable delivered slot count.
  - 480 s did not beat it typically, at twice the time and cost.
  - The author accepted the wait and the cost on 2026-10-07, so slots outrank time.
  - Teacher holes improve further at 480 s, but they rank below slots.
  - Advice for authors rather than a constant: two Generates at 240 s, keeping the better board,
    is likelier to find a free slot than one Generate at 480 s.

**Pinned quality baseline for S-309** (the shipped cell, `w4-s240-a300`). The four runs are
`45f6b562…`, `64361f52…`, `7ef1ad6b…` and `8f93406e…`. Mode A ran at 300 s in the campaign. The
shipped 60 s does not change the result, because Mode A never needed more than 4.12 s.

| Tier | Name               | best min | best median | best max | OPTIMAL | Stopped by budget |
| ---- | ------------------ | -------- | ----------- | -------- | ------- | ----------------- |
| 1    | completeness       | 0        | 0           | 0        | 4/4     | 0/4               |
| 2    | holes              | 0        | 0           | 0        | 4/4     | 0/4               |
| 3    | totalSlots         | 93       | 93          | 96       | 0/4     | 4/4               |
| 4    | teacherHoles       | 73       | 86          | 102      | 0/4     | 4/4               |
| 5    | softHits           | 0        | 0           | 0        | 4/4     | 0/4               |
| 6    | studentHoles       | 738      | 794         | 842      | 0/4     | 4/4               |
| 7    | doublesDeficit     | 0        | 208         | 264      | 1/4     | 3/4               |
| 8    | lateStarts         | 0        | 2           | 8        | 1/4     | 3/4               |
| 9    | fridayTail         | 30       | 35          | 40       | 0/4     | 4/4               |
| 10   | goldenBandDistance | 1        | 5           | 12       | 0/4     | 4/4               |

Delivered objective tuples, lexicographically best first. Run `64361f52…` produced the best delivered
board (proposal `fe0f2300…`):

| Run           | Delivered `[unplaced, holes, slots, teacherHoles, softHits, studentHoles, doubles, late, friday, golden]` |
| ------------- | --------------------------------------------------------------------------------------------------------- |
| `64361f52…`   | `[0, 0, 93, 80, 0, 781, 264, 8, 38, 7]`                                                                   |
| `7ef1ad6b…`   | `[0, 0, 93, 91, 0, 730, 164, 2, 32, 12]`                                                                  |
| `8f93406e…`   | `[0, 0, 93, 102, 0, 787, 248, 2, 40, 3]`                                                                  |
| `45f6b562…`   | `[0, 0, 95, 73, 0, 667, 0, 0, 30, 1]`                                                                     |

**What this verdict rests on, and what it does not cover.**

- 3–4 runs per cell, on one snapshot.
- Production `standard-4` numbers only; no M-series number reached a shipped constant.
- These questions stay open:
  - the drill's rescue path (2026-10-06 entry);
  - the renewal cadence, which needs one solve to cross two 10-minute expiries (routine at 240 s);
  - the 8-worker question;
  - stage-target values.

### 2026-10-07 — Final production Generate at the shipped constants (Phase 5, 5.3)

After #134 deployed (CI run 37617175484, Deploy green), `mise run solver:campaign -- run-one` ran one
Generate on the campaign plan with no override set.

- **Startup line** (cold start 12:18:53Z): `workers=4 stage_budget_s=240 mode_a_budget_s=60
  stage_targets=<none>`. The row's `solver_config` matches (`w4-s240-a60`).
- **Job `97d4013b…`** succeeded in **28.43 min** end to end, inside the UI's stated 38 minutes.
  Queue to claim took 4.2 s, with 4.45 s unaccounted. The clean fallback did not fire.
- **Delivered** `[0, 0, 94, 80, 0, 852, 216, 2, 34, 4]`. Its 94 slots and 80 teacher holes sit inside
  the 240 s cell's campaign range (93–95 slots, 73–102 teacher holes).
- **Mode A took 6.16 s**, above the campaign's 4.12 s maximum and still about 10× under the 60 s
  budget. The verdict's Mode A statements above describe the 13 campaign runs. Across all 14 runs
  Mode A took 3.18–6.16 s, and the PRD and roadmap now quote that range.

`ledger.json` is refreshed to all 14 rows.
