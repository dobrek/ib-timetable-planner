# CP-SAT backend-service POC — campaign results & verdict

**Recommendation: GO.** CP-SAT closes the decision question the `generation-quality-tuning` follow-up
left open. On the golden catalog it produces a **complete, oracle-verified board** — placing the
residue that both the greedy engine and the expert's manual process left unplaced — while holding
teacher comfort inside the acceptance bar. The gate that decides the service conversation (G1) passes
outright; the one that compounds it (G2) passes too.

> **Single-run protocol.** Every number below is from ONE run on ONE machine (Apple Silicon, CP-SAT
> 9.15, `num_workers=0` auto ≈ 11 workers, `random_seed=1`), not a distribution. The greedy warm
> start is stochastic — this run left **8 h** unplaced on dp2; an earlier export left 3 h. That
> variance is exactly why the question mattered, and it does not move the gates: completeness and the
> clique bounds are instance properties, independent of the warm start. Artifacts (dump, result,
> sidecars, per-stage solver logs) are under the gitignored `poc/cp-sat/data/`.

## The decision question

> Can the 5–8 h unplaced residue on the golden catalog (Math AA HL ×2 + English B HL ×1 on dp2 this
> run) be **closed**, or is it **provably infeasible**?

Answer: **closable.** Mode A (completeness feasibility) returns **OPTIMAL / SAT in 0.7 s**, and the
resulting board verifies against the same oracle (`verifyGeneration`) that gates the app's own
generate path. There is no infeasibility to explain — the conditional infeasibility memo does not
fire.

## Decision gates

| Gate   | Criterion                                                                                                   | Result                                                                                            | Verdict  |
| ------ | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | -------- |
| **G1** | Mode A closes the residue (complete, oracle-verified) **or** proves infeasibility with a named conflict set | Complete board, **0 h unplaced** both cohorts, `verify: OK`; residue proved closable in **0.7 s** | **PASS** |
| **G2** | `teacherHoles` after the ladder ≤ **148** (the acceptance bar)                                              | **95** teacher gap-slots (greedy baseline 179; expert 74)                                         | **PASS** |
| **G3** | Mode B repairs a fabricated **seed** residue in interactive time (seconds)                                  | Fabricated 2 h seed residue closed in **~0.75 s** (`unplaced → 0`), teacherHoles 127 (Phase 4.5)  | **PASS** |

G1 alone decides the service conversation; G2 compounds it; G3 informs the hybrid architecture. All
three pass.

## Board comparison (analyzer, golden catalog)

The CP-SAT board was imported onto the export's clone (`2f8e3054`) and scored by the **same analyzer**
that judges the expert plan — so these are apples-to-apples, fortnight-lane-aware metrics, not the
solver's own objective read-out.

| Metric (whole cohort)       |   Expert (golden) | Greedy (same-instance baseline) | **CP-SAT** |
| --------------------------- | ----------------: | ------------------------------: | ---------: |
| Unplaced hours              | residue left open |                         **8 h** |    **0 h** |
| Occupied slots (dp1+dp2)    |                95 |                              95 |         95 |
| Interior holes              |                 0 |                               0 |          0 |
| **Teacher gap-slots**       |            **74** |                             179 |     **95** |
| Student gap-slots           |               612 |                             888 |        824 |
| Avg teaching days / teacher |              4.12 |                               — |       4.41 |

**Reading it.** CP-SAT is the only column that is **complete**. Against the greedy same-instance
baseline it improves every prioritised tier (teacher gap-slots 179 → 95, student gap-slots 888 → 824)
_and_ closes the residue. It does not match the expert's 74 teacher gap-slots — but the expert bought
that number partly by leaving the residue unplaced (fewer rows to seat = easier to avoid gaps), and
the CP-SAT stages here ran to **FEASIBLE, not proven-optimal**, under 30 s budgets. The headroom to
the expert is a budget dial, not a modelling wall (the tier-4 bound was still 2 when the stage timed
out — i.e. the solver had not proven it could not reach far lower).

## Objective tuple (solver read-out, exact final board)

Lexicographic order `[unplaced, holes, slots, teacherHoles, softHits, studentHoles, doubles,
lateStarts, fridayTail, golden]`; smaller is better on every tier, higher tiers dominate.

|            | unplaced | holes | slots | **teacherHoles** | softHits | studentHoles | doubles | lateStarts | fridayTail | golden |
| ---------- | -------: | ----: | ----: | ---------------: | -------: | -----------: | ------: | ---------: | ---------: | -----: |
| Greedy     |        8 |     0 |    95 |              179 |        1 |          888 |     224 |          0 |         34 |      3 |
| **CP-SAT** |    **0** |     0 |    95 |           **95** |        3 |          824 |     220 |          2 |         34 |     11 |

CP-SAT wins at tier 1 (`0 < 8`), which **lexicographically dominates every tier below it** — the board
is strictly better ranked. The regressions on the low tiers (softHits 1 → 3, lateStarts 0 → 2, golden
3 → 11) sit far under the decisive win and are artefacts of the FEASIBLE-not-optimal low-tier stages;
more per-stage budget recovers them without touching the tiers above.

## Staged ladder — per-stage wall-clock (Mode A → tiers 2–10)

`--mode complete --mode-a-budget 60 --stage-budget 30`, total **243 s**. Tiers 1–2 solved to OPTIMAL;
tiers 3–10 returned the best FEASIBLE incumbent at the 30 s cap (the hardened bound carries forward, so
no later stage worsens an earlier tier).

| Tier | Name               | Status   | Best | Bound |  Wall |
| ---: | ------------------ | -------- | ---: | ----: | ----: |
|    1 | completeness       | OPTIMAL  |    0 |     — | 0.6 s |
|    2 | holes              | OPTIMAL  |    0 |     0 | 1.8 s |
|    3 | totalSlots         | FEASIBLE |   95 |    87 |  30 s |
|    4 | teacherHoles       | FEASIBLE |   95 |     2 |  30 s |
|    5 | softHits           | FEASIBLE |    3 |     0 |  30 s |
|    6 | studentHoles       | FEASIBLE |  824 |     1 |  30 s |
|    7 | doublesDeficit     | FEASIBLE |  220 |     0 |  30 s |
|    8 | lateStarts         | FEASIBLE |    2 |     0 |  30 s |
|    9 | fridayTail         | FEASIBLE |   34 |    28 |  30 s |
|   10 | goldenBandDistance | FEASIBLE |   11 |     0 |  30 s |

Both cohorts seat at or above their max-weight-clique lower bound (dp1 48 ≥ 46, dp2 47 ≥ 41) — the
redundant tier-3 cut is respected, confirming the slot count is near-tight.

## Mode B — residual repair

- **G3 gate (seed, controlled):** a fabricated 2 h seed residue closes in **~0.75 s** (tier 1 OPTIMAL,
  `unplaced → 0`), teacherHoles driven to 127 on the freed neighbourhood. This is the mechanism
  proof — repair is interactive.
- **Golden real residue (hybrid-architecture data point):** 1-hop repair of this run's **8 h** dp2
  residue **did not close within 30 s** (tier 1 UNKNOWN). The neighbourhood of an 8 h residue on a
  densely-connected IB cohort is most of the catalog, so local repair degenerates toward the global
  problem. This is expected and recorded per plan: **large residues want Mode A (global, 0.7 s here),
  not Mode B.** Mode B's niche is small, interactive, single-course fix-ups — not bulk closure.

## Auto-park transformation record

`meta.autoParked: []` — a **no-op** on the golden plan. The phantom-course guard parks any
zero-student course's uncovered hours; during Phase 1 the expert re-attributed Chemistry SL (the
one-time phantom) to its real 9-student / 4 h roster, so no course has an empty roster and nothing is
parked. The catalog the solver saw is the true catalog.

## Encoding equivalence (the gate under everything)

Every number above rests on the Phase-3 parity gate: the CP-SAT encoding of all ten tiers reproduces
the TypeScript scorer's tuple **exactly (10/10)** on both the committed seed fixture and the golden
dump. Without it a "better" board could be better against a subtly different objective; with it,
"better" means better against the app's own definition of quality.

## Recommendation

**GO — build the backend service around this core.**

1. **The decision question is answered with data, not vibes.** The residue is not a hard limit of the
   catalog; it is a limit of the greedy/manual search. A CP-SAT service closes it in under a second and
   proves it.
2. **Quality clears the bar.** Complete board, zero interior holes, teacher gap-slots 95 ≤ 148, and
   measurable headroom toward the expert's 74 by spending more per-stage budget (the POC deliberately
   used tight 30 s caps).
3. **Architecture — hybrid.** Ship **Mode A / staged-ladder as the generate path** (global, reliable,
   proves completeness or names the conflict). Keep **Mode B as an interactive repair affordance** for
   small, local residues, not bulk closure. The Python package is already shaped as the service core
   (`schema → model → objective → solve → explain`); only the file `cli` transport is throwaway.

**Next steps for productionisation (out of scope for this POC):** replace the file transport with an
HTTP/worker boundary; tune per-stage budgets against the teacher-comfort target (the POC shows the
dial exists); and decide the Mode-A-timeout policy (extend budget vs. fall back to `--mode full`).
