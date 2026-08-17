---
change_id: solver-deploy-lane
title: Solver deploy lane
status: implementing
created: 2026-08-15
updated: 2026-08-17
archived_at: null
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

### 2026-08-17 — Phase 1 measurements: the image is 394 MB, and the credential check is fatal at boot.

**Image**: `ib-solver:local` builds at **394 MB** on `python:3.13-slim`, linux/amd64 — inside the
330–450 MB band the research projected, and the number `CONTAINER_START_TIMEOUT_MS` (Phase 2) and the
Phase 7 cold-start measurement should be read against. First build on this machine took ~2m24s
including the cross-arch base pulls; that is the figure the CI deploy wall-clock will be compared to.

**Where the role assertion runs.** Plan review F1's Fix A shipped: a startup (FastAPI lifespan)
assertion *plus* the per-mint one in `sign_in()`. The startup half is fatal — uvicorn exits non-zero
on a lifespan error, so the container never binds :8000. Drilled with a deliberately wrong password:
the container exited, and `mise run solver:image:smoke` reported it as "exited before binding :8000"
rather than hanging. The wrong-*role* half was drilled separately by disabling the local hook.

**What the tier-2 smoke actually proved**, beyond 202: the container's own startup line reads
`wire_contract=loaded` (so the `parents[4]` layout holds inside the image) and `workers=4` (so the
`envVars` channel production will use works). `.venv` (269 MB of arm64) and `services/solver/data`
stayed out of the context; `contracts/` came in. ortools imports cleanly under amd64 emulation on
Apple silicon — no SIGILL, so tier 2 is usable on this hardware for correctness (never for timing).

**A gap worth naming.** The smoke's default job id has no queued row, so the worker correctly logs
"not claimable" and stops — the smoke alone cannot show a row advancing. The full
`queued → running → succeeded` advance through the *image* was proved instead by running the
container on :8000 and pointing `solver-transport.integration.test.ts` at it. That recipe is not a
mise task; if it is wanted repeatedly, it belongs in the README's tier-2 section (Phase 3 §4).

### 2026-08-16 — No path filtering in CI. Deliberate deviation from FR-315's wording.

**Decision:** the solver verify job stays unfiltered, and no `paths:`/`paths-ignore:` filter is added anywhere in `ci.yml` — including around the container image build.

**Why.** FR-315 specifies "a **path-filtered** solver verify job", and the rationale for filtering is saving CI time. The measurement does not support it: `verify`, `integration`, `e2e` and `solver` carry no `needs:` between them, so they run in parallel and the critical path is `e2e` at **426 s**. The `solver` job is **44 s**. Filtering it out moves the critical path by zero — it saves billed runner minutes, not wall clock.

Against that ~nothing, filtering costs a rewrite of `deploy`'s `if:` gate, because a skipped job is not a success and would skip `deploy` (i.e. stop shipping main). The `always() && !contains(needs.*.result,'failure')` form that fixes it also switches off the implicit success gate for **all four** needs simultaneously — a silent, high-impact regression surface on the only job that touches production. `contracts/**` is additionally cross-cutting (byte-gated by both suites), so a naive `services/solver/**` filter would skip the Python half of the very gate `ci.yml:151-155` says that job exists to make honest.

**Accepted cost.** The image build now runs on every merge to main, doc-only merges included. Layer *push* stays incremental (registry-side dedup), but the *build* re-runs from scratch on each ephemeral runner. If deploy wall-clock becomes a problem the lever is GitHub Actions Docker layer caching (`cache-from`/`cache-to: type=gha`), **not** reintroducing path filters — that keeps the `deploy.needs` gate untouched.

**Doc obligation.** FR-315's "path-filtered" wording and the roadmap's S-302 Outcome now overstate what will ship. One of the two must move: either amend the FR, or record the deviation where the next reader meets it. Not a silent skip — see `context/foundation/lessons.md` on conventions that cite a mechanism.

### 2026-08-16 — Scope decisions: doc truth-up IN, roll-forward-only, E2E deferred to S-306.

**Doc truth-up is in S-302's scope.** The slice carries a documentation phase correcting what it makes false. Precedent: `clean-up-bench-generation` shipped the same shape (`docs(...): truth-up the engine-situation docs (p4)`). Known items, all evidenced in `research.md`:

- **FR-315's "path-filtered"** — amend; nothing will be path-filtered (see the no-filtering decision).
- **FR-315's "container secrets live in container config, not the Worker"** — restate. On Cloudflare the documented channel *is* Worker secrets (or Secret Store) forwarded to the container via `envVars` on the Container class; there is no `containers[].configuration.secrets`. The *intent* (the Worker gains no new privilege) holds and should be preserved in the new wording.
- **The ≈$7/month cost figure** (`prd.md`, `roadmap.md`, `shape-notes.md`) — restate to ~$15/month; the arithmetic was right, the 5-minute solve input was overtaken by the measured ~12.5 min.
- **containers#162 as a live hazard** (`CLAUDE.md`, `prd.md` FR-311, `roadmap.md` S-304 rationale) — fixed in `@cloudflare/containers` v0.2.2, closed 2026-05-12. Re-ground S-304 on the platform's durable statement instead: *"Cloudflare does not guarantee that any container instance will run for any set period of time."* **Do not delete S-304** — the wedged-`running`-row problem is ours, not Cloudflare's.
- Also stale and cheap to fix while in there: `python:3.12-slim` (`tech-stack.md:45,51`, `shape-notes.md:617-618`), "solver at `poc/cp-sat`, promoting" (`tech-stack.md:33-35`), "solver tests run nowhere in CI" (`health-check.md:115-117`, `stack-assessment.md:59`), mise graduation attributed to S-302 (`roadmap.md:77`), and the deleted `bench` job cited as a CI template.

**Rollback: roll-forward-only, no empirical test.** S-302 does **not** spend a production deploy cycle discovering whether `wrangler rollback` restores a container image. It ships the explicit policy instead, because the action is the same either way. Two deliverables: update `README.md`'s Rollback section to say container deploys are fixed forward with a new `wrangler deploy`, and record the two supporting facts — a Durable Object migration between versions *blocks* `wrangler rollback` outright (and containers are DO-backed), and *"Resources connected to your Worker will not be changed during a rollback."* Operational corollary: **never `wrangler containers images delete` an image still referenced by a reachable Worker version.**

**E2E for Generate: deferred to S-306, not S-302.** `clean-up-bench-generation` handed the gap to "S-306 or the FR-315 solver-lane work"; the ambiguity is now resolved in S-306's favour. S-302 does not add a browser test, and must not be reported as closing that gap — it remains open and owned.

### 2026-08-16 — Hazard: prefer the dashboard toggle over `supabase config push` for hosted hook enablement.

S-302's checklist says "`supabase config push` (or dashboard toggle)" to enable the Custom Access Token Hook on hosted. **Prefer the toggle.** `config push` sends the *whole* local `supabase/config.toml`, and the local file carries settings that would be actively wrong on hosted:

- `site_url = "http://127.0.0.1:3000"` (`supabase/config.toml:154`) and `additional_redirect_urls = ["https://127.0.0.1:3000"]` (`:156`) — pushing these would point the hosted project's auth Site URL at localhost, breaking redirect-bearing auth flows in production. (Both are stale even locally: the app serves on 4321.)
- `enable_confirmations = false` (`:212`), `secure_password_change = false` (`:214`), `minimum_password_length = 6` (`:175`).

The runbook already notes `config push` "rewrites the whole hosted `config.toml`" and that this is why the `deploy` job never runs it — this entry records *which* settings make that dangerous. If `config push` is used anyway, preview the diff first and fix `site_url`/`additional_redirect_urls` beforehand. **Exact push surface is unverified** — confirm against current Supabase CLI docs before running either way.

### 2026-08-16 — Requirement: a local-app / hosted-database solve mode (author request).

**Want.** Run the whole app locally against the **hosted** Supabase project, with the solver as a native process, to test plan/policy variations against real current data cheaply and without spending Cloudflare container time.

**Note the split.** "Without Cloudflare" already works today at tier 1 (`pnpm env:local` + `mise run solver:dev`) and S-302 must not remove it — the URL transport is also CI's integration lane. The genuinely new part is pointing that loop at **hosted data**.

**Author's local loop is `pnpm build && pnpm preview`, not `pnpm dev`** (stability). This is a standing preference and it shapes the design here, because `astro preview` runs the **built** worker through `@cloudflare/vite-plugin` against the generated `dist/server/wrangler.json` — i.e. against the config that will carry the `containers` block. Preview is therefore *more* likely to instantiate the container binding than dev is, not less. Two upsides worth keeping: preview exercises the real `src/worker.ts` entry (S-302's riskiest change) at full fidelity, and it is the same path `playwright.config.ts` and the CI `e2e` job already use.

**Three implementation implications for the plan:**

1. **A third env profile, not an edit to `prod.vars`.** `.envs/prod.vars` deliberately omits `SOLVER_URL`; editing it would disable that guard permanently and silently. Add `.envs/prod-solver.vars` + `pnpm env:prod-solver` so the mode is named and opt-in, and plain `env:prod` stays the documented read-only smoke test. Both `env:*` scripts write `.env.local` **and** `.dev.vars`, so preview (which reads `.dev.vars`) is covered by the same mechanism.
2. **Transport selector precedence: an explicit `SOLVER_URL` must win over the binding.** If the binding wins, the author's build+preview loop is pushed onto Docker for every local test — the opposite of "fast and cheap". Binding is the fallback, used when no URL is set (i.e. production).
3. **Consider `"dev": { "enable_containers": false }` in `wrangler.jsonc`.** Present in the Wrangler 4.102.0 schema, default `true`. Setting it false should keep local dev/preview from touching Docker at all while production still gets the container. **Unverified — verify during the plan**, including whether an absent binding degrades cleanly (it should: `getSolverTransport()` already returns `null` when nothing is configured).

**Prerequisite: none extra.** The native solver writing to hosted `generation_jobs` needs the hosted machine credential, which is already S-302's manual checklist (`docs/runbooks/solver-credential.md:208-224`). The capability arrives when hosted enablement lands.

**Correction to an existing doc claim.** `.envs/prod.vars` says a `SOLVER_URL` value there "would give prod a dispatch surface pointing at a developer machine". `prod.vars` is copied only to `.env.local` and `.dev.vars` — both gitignored, neither deployed; the Worker's secrets come from `wrangler secret put`. The real hazard is narrower: *a developer running locally against hosted data dispatches production jobs to their laptop.* Restate the comment when the third profile lands, so the guard's reason matches what it guards.

**Risks this mode carries — it is writing to production, not smoke-testing it:**

- **Sharpest: a laptop that sleeps mid-solve wedges a production row.** The claim CAS filters `status=eq.queued`, so a row left at `running` is unclaimable until S-304 widens it, and one-active-job-per-plan means that plan's Generate is stuck. Recovery today is manual SQL against hosted. Far likelier on a laptop than in a container.
- **Not read-only**: generation inserts job rows, calls `clone_plan` (real plans), and applies placements. Expect clone accumulation in hosted.
- **Timing conclusions are invalid, quality conclusions are usable.** M4 ≈ 2.3–2.5× per-core plus 8-vs-4 workers ⇒ the recorded 3–5× wall-clock multiplier; the PRD forbids M4-derived budgets reaching S-308. Board *quality* is target-defined and hardware-independent, so policy comparison is legitimate — but worker count changes *which* equally-good board returns, so a local board is not what production would emit.
- **Real names on the dev machine.** The solver still sees UUIDs only (PII posture intact), but the app renders hosted data; never commit an exported dump.

### 2026-08-16 — `SOLVER_WORKERS` ships as 4 in container config; S-308 revisits.

**Decision:** the container config sets `SOLVER_WORKERS=4` **explicitly**. It is not left to inherit the code default.

**Why.** Two prior documents disagreed and nobody reconciled them: the seed research obliged `num_workers=4` (matching `standard-4`'s 4 vCPU), while F-302 shipped `DEFAULT_WORKERS = 8` (`services/solver/src/cpsat_service/settings.py:31`) documented as "pinned for reproducibility — never 0/auto". Eight logical CP-SAT workers timesharing four cores is a third regime: the pin is nominally honored while the reproducibility property it exists to protect is not, since portfolio interleaving decides which equally-legal board wins.

Supporting measurement (small seed fixture, not the golden catalog — suggestive, not conclusive): 8 workers → 854 MB peak RSS / 39 s; 4 workers → 505 MB / 37 s. Eight was not faster and cost ~70% more memory.

**The load-bearing half is "explicitly".** The real failure mode is `8` silently inheriting into production because nothing set it. S-302 writes the container config, so whatever ships here becomes the fixture S-308's calibration campaign measures against — and the PRD forbids tuning budgets anywhere but the production instance.

**Known trade-off, not a free win.** CP-SAT's own guidance is a minimum of 8 workers, sweet spot 16 true cores. At 4 the LNS pool survives but portfolio diversity drops: feasibility solves are barely affected, optimality proofs and lower-bound progress get slower and higher-variance. That is the 4-vCPU platform ceiling, not a preference — and it is exactly the condition the PRD names as the trigger for the Cloud Run / Fly.io escape hatches. S-308 owns re-evaluating it on production hardware.
