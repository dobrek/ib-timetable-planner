# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-06-15 (refresh — post-FSD, rollout re-sequenced)

## 1. Strategy

Tests follow three non-negotiable principles for this project:

1. **Cost × signal.** The cheapest test that gives a real signal for the
   risk wins. Do not promote to e2e because e2e "feels safer." Do not put a
   vision model on top of a deterministic check that already catches the
   regression.
2. **User concerns are first-class evidence.** Risks anchored in "the team
   is worried about X, and the failure would surface somewhere in <area>"
   carry the same weight as PRD lines or hot-spot data.
3. **Risks are scenarios, not code locations.** This plan documents *what
   could fail* and *why we believe it's likely* — drawn from documents,
   interview, and codebase *signal* (churn, structure, test base). It does
   NOT claim to know which line owns the failure. That knowledge is produced
   by `/10x-research` during each rollout phase. If the plan and research
   disagree about where the failure lives, research is the ground truth.

A fourth, **project-specific** principle governs this rollout in particular:

4. **Tests are the refactor safety net, never a refactor blocker.** This
   codebase is early and substantially LLM-generated. The *prior* structural
   refactor this principle was first written against **has since landed**
   (archived `2026-06-08-architecture-refactor`, 5 phases): a pre-existing
   behavioral net held green through the FSD relocation, and the base has grown
   from a 15-test baseline to **55 unit + 10 integration** since. The **next**
   refactor is already named: the enriched collision-core rewrite — roadmap
   **S-02 → S-04**, above all **S-03's unified-rule rewrite** of
   `collisions.ts` / `collision.ts` / `drop-hints.ts` — reworks the protected
   four-class core. The **55 unit tests** (above all `collisions.test.ts`) are
   the net that rewrite must survive **without a behavioral change**. Every
   test the rollout adds must assert **observable behavior at a stable
   boundary** — the validator's verdict, the user-visible drop feedback,
   auth/RLS enforcement, persistence durability — the contracts that survive a
   refactor. Tests must **never** mirror internal structure that is liable to
   move. If a test would have to change purely because internals were reshaped
   and no behavior changed, it is the wrong test. This is the direct answer to
   interview Q2 and the convention the §3 Phase 4 parity gate enforces.

Hot-spot scope used for likelihood weighting: `src/` (excluding tests, build
output, `data/` fixtures, `context/` docs).

## 2. Risk Map

The top failure scenarios this project must protect against, ordered by
risk = impact × likelihood. Risks are failure scenarios in user / business
terms, not test names. The Source column cites the *evidence that surfaced
this risk* — never a specific file as "where the failure lives" (that is
research's job, see §1 principle #3).

| # | Risk (failure scenario) | Impact | Likelihood | Source (evidence — not anchor) |
|---|--------------------------|--------|------------|--------------------------------|
| 1 | The validator marks a placement **valid that actually collides** for a student (the shipped student-collision class) — the author trusts and ships a broken timetable. | High | High | PRD §Guardrails L166 (no wrong-positive); interview Q1; FSD evidence dir `src/_pages/plan-detail/{model,api}` |
| 2 | The **drag → action → grid feedback loop renders the wrong verdict** — an optimistic UI keeps showing "valid" after the server returns invalid, so the user never sees the collision. | High | High | interview Q3 + Q4; FSD evidence dir `src/_pages/plan-detail/{ui,api}` |
| 3 | A **server-mutation boundary diverges from its tested core** — every app-data mutation/compute now flows through Astro Actions (`src/actions/` barrel over `_pages/*/api/` handlers; the placements/grouping API route was migrated away). Untested at the **wrapper-over-a-real-HTTP-`/_actions/*`-request** layer: broken auth enforcement, wrong `DomainError`→`ActionError` translation, failed persistence, off-contract response, or no server-side re-validation of untrusted input. | High | Medium | interview correction (Actions are now the sole mutation transport); test base: the wrapper contract is unit-tested but no integration test invokes a real Action over HTTP; lessons.md Actions-only rule |
| 4 | **Placed work is lost** — a placement does not survive reload/crash, or a write is silently dropped, violating the work-durability promise. | High | Medium | PRD NFR Work durability L173; FSD evidence dir `src/_pages/plan-detail/api` |
| 5 | **Unauthenticated access, or a regression of the author-only privacy invariant** — an Astro Action handler missing `requireSession()` (the `/_actions/*` path is exempt from the middleware redirect by convention, so the gate is per-handler), or student names/choices leaking beyond their author. The rewritten PRD makes **no access-control change**, so the job is to *preserve* the existing author-only invariant, not to cover a change-introduced surface. Per-author RLS / cross-author IDOR stays a **deferred, prerequisite-gated** concern (candidate Phase 2.5), not a surface this wave introduces. *(abuse: authorization / IDOR)* | High | Medium | PRD Privacy L177 (student names + choices author-only), Constraints L379 + Access Control Changes L434 (no access-control change); Actions self-enforce auth (interview correction + `src/actions` convention); cross-author RLS still untested; FSD evidence dir `src/_pages/sign-in/ui`, `src/pages/auth` |
| 6 | **A new enriched-dimension false-positive class passes as valid** — *refresh inference, not yet live:* as each enriched dimension ships, the validator could mark a placement valid that the richer rule should reject — a new false-positive class under the L166 no-wrong-positive guardrail. The family: **S-02** co-teaching (both teachers of a co-taught course count as occupied), **S-03** bi-weekly opposite-week overlap (the unified-rule rewrite), **S-04** cross-cohort symmetric teacher occupancy, **S-06** both-cohorts-at-once. | High | High | refresh inference grounded in roadmap S-02 / S-03 / S-04 / S-06 + PRD L166–170 (the enriched no-false-positive surface); **no code anchor — classes not built**. Not testable until each class ships; response is the §3 Phase 4 parity harness, per slice. |
| 7 | **A bundle operation or a parked bundle loses in-progress work** — a bundle move/remove/replace, or a bundle parked off-board, drops placed work, breaking the no-silent-loss-on-refresh / tab-close promise. *refresh inference, not yet live.* | High | Medium | refresh inference grounded in roadmap S-05 (`first-class-bundle-operations`, `ready`) + S-07 (`bundle-holding-container`; Secondary success criterion — a parked bundle survives refresh) + PRD durability L173; interview Q1 fear #2 + Q3 low-confidence. Implementation pitfall when the slices ship: guard `localStorage` with try/catch (`lessons.md:40-45`). |

> **Ordering note.** Rows are ordered by risk = impact × likelihood, but that
> ordering is **approximate for the forward-inference rows** (#6 High × High,
> #7 High × Medium): those classes are not yet built, so their likelihood is an
> estimate, not an observed rate. #6 listed after the live High × Medium #3–#5
> is editorial placement, not a strict-priority claim — the table is not
> re-sorted around the not-yet-live rows.

**Abuse / security lens applied.** Risk #3 carries the untrusted-input /
server-parity surface; Risk #5 carries authorization/IDOR and PII leakage.
Resource-abuse (rate-limit bypass, flood) is noted **low-priority and
deliberately unmapped**: registration is closed to an approved author set
(roadmap F-01), so the attacker pool is small and trusted.

### Risk Response Guidance

| Risk | What would prove protection | Must challenge | Context `/10x-research` must ground | Likely cheapest layer | Anti-pattern to avoid |
|------|-----------------------------|----------------|--------------------------------------|-----------------------|-----------------------|
| #1 | A hand-built fixture where two students share a course across one slot is **rejected**; a clean fixture is accepted. **Full closure additionally requires a test proving the server *write path* refuses to persist a known collision — currently unmet** (validation is a pure in-memory board check, decoupled from persistence; no server re-validation gate exists). | "`collisions.test.ts` already covers this" — does it, or does its oracle mirror the implementation? And does any test cover the persist gate, or only the in-memory verdict? | Where the collision rule lives; whether the existing test's expected values come from requirements or from the code under test; whether the write path re-validates before persisting. | unit (core verdict); integration (server-persist refusal — not yet built) | **Oracle problem** — expected values lifted from the validator's own code; coupling to internal structure rather than the verdict contract. Also: treating the in-memory oracle as full Risk #1 closure while the persist gate stays untested. |
| #2 | A server "invalid" verdict **visibly renders as invalid** in the grid; an accepted drop renders valid; optimistic UI state reconciles with the server response. | "the API returned invalid" ≠ "the user saw invalid". | How the React island consumes the API response; the optimistic-update reconciliation path. | component / integration (React island); ≤1 e2e only if integration cannot reach the loop. | Over-mocking the API so the test passes regardless of the real contract; meaningless snapshot; coupling to component internals. |
| #3 | A request hitting the boundary — the **Action wrapper over a real HTTP `/_actions/*` request** — enforces auth, translates a domain error to the correct client error, persists, and rejects malformed/untrusted input. | "the domain function is tested, so the boundary is fine" — the *handler wiring* is what is untested. | The real handler path (Astro's action context over `/_actions/*`); the persistence call; the response/error contract shape; the `requireSession` enforcement point. | integration (real Action via Astro's action context, local Supabase). | Mocking the domain function *inside* the boundary test (tests nothing); re-testing `src/_pages/courses` logic that is already covered. |
| #4 | After a reload, the grid **restores exactly** the placed state. | "the write returned 200" ≠ "the work is durable". | The persist + read-back path; RLS on read; what reload actually re-fetches. | integration (local Supabase). | Asserting the DB write happened instead of asserting that reload restores the placed grid. |
| #5 | An Action invoked **without a session is rejected**; author B **cannot read or mutate** author A's students/placements/catalog. | "the middleware protects everything" — `/_actions/*` is exempt; "logged in" ≠ "authorized for this row". | RLS policies and ownership column; per-handler `requireSession` coverage; the gated-route set. | integration (local Supabase + auth, both mechanisms). | Happy-path single-author only — the attacker is a *different* authenticated author, not an anonymous one. |
| #6 | *(not testable until each class ships)* As each enriched dimension lands, a fixture the richer rule should reject is **rejected** and a clean one is accepted — a per-slice parity fixture (expected values from requirements) guarded by the §3 Phase 4 harness across S-02 / S-03 / S-04 / S-06. | "the in-cell checks already cover this" — they do not; today's core is single-cell, single-teacher, single-cohort, and week-agnostic. | Each new class's added dimension (teacher-set, week parity, cross-cohort occupancy, both-cohorts context); the parity oracle's expected values (from requirements, not the new code). | unit (parity fixture) once each class exists. | Shipping a new class without a false-positive parity guard; lifting the oracle's expected values from the new validator's own code. |
| #7 | A bundle op (move/remove/replace) and a **parked** bundle both **survive a reload** with their placed work intact — prove restore, not the write. | "the write returned 200" ≠ "the parked bundle came back after refresh". | The bundle persistence + read-back path; what a refresh / tab-close re-fetches or re-hydrates; the `localStorage` guard (try/catch) if park state is client-persisted. | integration (local Supabase) for the server path; component for the client-restore path. | Asserting the write happened instead of asserting that reload restores the bundle / parked state. |

**Placement-validation performance budget (not a CI gate).** Drag-drop
constraint validation carries a **sub-200 ms budget** per placement. By team
decision this budget is **deliberately not a CI gate** — it is verified
**manually / by feel** during development, not asserted by an automated perf
test. Rationale: a wall-clock perf assertion on shared CI runners is flaky and
would block merges on noise rather than real regressions. This is a budget +
governance decision, not a "validator marks X valid" failure scenario, so it is
recorded here as prose (and as a §7 exclusion) rather than as a scored risk row.
(Source: Phase 2 interview Q5 + the 2026-06-18 refresh interview.)

## 3. Phased Rollout

Each row is a discrete rollout phase; an unstarted phase opens its own change
folder via `/10x-new`. Status moves left-to-right through the values below; the
orchestrator updates Status as artifacts appear on disk. The next active phase
is cued in its Phase-name cell (**next active**) — that cue is **not** a status
value.

| #   | Phase name                                                          | Goal (one line)                                                                                                                  | Risks covered                                | Test types                                                                | Status      | Change folder                                                         |
| --- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------- | ----------- | --------------------------------------------------------------------- |
| 0   | Integration harness + CI lane                                       | Stand up the DB-test infrastructure (plan-rooted factories, scenario builders, CI integration lane) the rollout assumed.         | enabler; #1, #3 (persist half), #4 (partial) | integration (factory harness) + CI lane                                   | complete    | `context/changes/data-for-e2e-and-integration-tests/`                 |
| 1   | Validator trust core (independent oracle) — **complete (absorbed)** | Prove a false-positive cannot pass the core; covers the domain persist path (the placements/grouping route migrated to Actions). | #1                                           | unit (independent oracle)                                                 | complete    | — (absorbed into organic feature/refactor growth; no discrete change) |
| 2   | Auth + Astro Actions boundary + RLS / PII                           | Prove every Action self-enforces session, no cross-author read/mutate, and error translation holds.                              | #5 (unauth half), #3 (Actions)               | **e2e (Playwright, workerd preview) + integration (local Supabase + auth)** — hybrid | implementing | context/changes/testing-auth-actions-boundary-rls/                    |
| 3   | Drag → validate → feedback loop + persistence reload-restore        | Prove a real collision visibly reads "invalid" and placed work survives reload.                                                  | #2, #4 (reload-restore)                      | component / integration (planner island); persistence integration; ≤1 e2e | not started | —                                                                     |
| 4   | Parity harness for new validator classes (owns S-09)                | Lock a convention + fixture harness so future validator classes (roadmap S-03, S-09) ship with parity guards.                    | #1-class, S-09                               | gates + table-driven fixture harness                                      | not started | —                                                                     |

**Notes.**

- **Phase 0** stood up `data-for-e2e-and-integration-tests` (closed 2026-06-15)
  and owns the server-mutation boundary. Its three risks map honestly: Risk #1
  in-memory oracle holds; Risk #3 **persist half only** (the Actions-over-HTTP +
  auth boundary is still unit-only); Risk #4 write-then-read-back holds, but the
  production reload-restore path is deferred to Phase 3.
- **Phase 1** was **absorbed** into organic feature + refactor growth — the
  independent-oracle unit tests satisfy Risk #1 today, but no discrete Phase 1
  change ever shipped. The old **Risk #3 route half is dropped**: the
  placements/grouping API route migrated to Astro Actions, so Phase 0 alone
  owns that boundary (no double-count).
- **Phase 2** carries an explicit **prerequisite**: an ownership column + real
  per-author RLS policies must land before cross-author tests are meaningful.
  Today RLS policies are permissive (`using(true)`) and the integration suites
  use the service-role key, which bypasses RLS — so "authenticated = full
  access," not per-author ownership.
- **Phase 2 is a hybrid, and it introduced the project's first Playwright e2e
  harness** (`testing-auth-actions-boundary-rls`) — the reusable browser-test
  pattern was **not** deferred wholesale to Phase 3. The split: e2e owns the
  browser-observable truths (sign-in → `storageState` reuse → protected
  dashboard; guard redirect; no-session Action refused with `UNAUTHORIZED` over
  real HTTP), while the Vitest integration complement owns the matrix-shaped
  truths (`DomainError`→`ActionError` for the in-scope codes, malformed-input
  rejection, `createPlan` persistence at the `.handler` layer). A new CI `e2e`
  job runs the suite against a real workerd preview and **gates deploy**; a
  `GRANT … TO authenticated` migration pins table reachability. **Deferred:**
  the `createPlan` UI-driven happy-path e2e (a later browser test once the
  pattern is established) and the **cross-author / IDOR half of #5** (waits on
  the ownership-column + real-RLS prerequisite above — candidate Phase 2.5).
  See §6.3 for the reusable harness pointer.

**Status vocabulary** (fixed — parser literals): `not started` → `change
opened` → `researched` → `planned` → `implementing` → `complete`.

## 4. Stack

The classic test base for this project. AI-native tools (if any) carry a
`checked:` date so future readers can see which lines need re-verification.

| Layer | Tool | Version | Notes |
|-------|------|---------|-------|
| unit | Vitest | (see lockfile) | `vitest.config.ts`; **55 unit** test files — 53 co-located `*.test.ts` siblings under the FSD slices + 2 infra-guard suites in `src/test/` (`no-seed-coupling`, `seed-transcode-identity`). |
| integration | Vitest | (see lockfile) | `vitest.integration.config.ts`; **9 integration** suites; plan-rooted scenario factory harness at `src/test/factories/`; requires the local Supabase stack (`pnpm test:integration`). Live **CI integration lane**: regenerate seed → boot a trimmed Supabase stack → `pnpm test:integration --maxWorkers=2` (the 2-worker cap is a CI runner-resource hedge). Mutations/compute flow through **Astro Actions only** — a real Action over `/_actions/*`; the placements/grouping API route is gone. |
| e2e | Playwright (`@playwright/test`) | (see lockfile) | First harness shipped in §3 Phase 2 (`testing-auth-actions-boundary-rls`): root `playwright.config.ts` + top-level `e2e/` (invisible to steiger + Vitest). Three projects — `setup` (logs in once → `storageState`), `chromium` (authenticated), `chromium-guard` (no cookies, negative/unauth specs). `webServer` runs `pnpm build && pnpm preview` for true **workerd** fidelity; chromium-only. `pnpm test:e2e` locally + a CI `e2e` job that gates deploy. `@playwright/cli` stays the authoring/healing aid (not the runner). Drag→feedback e2e remains §3 Phase 3. |
| edge runtime | n/a | — | Code runs on Cloudflare Workers (workerd) in dev and prod — edge-safe libs only, no Node APIs (`fs`, `child_process`, native). |

**Stack grounding tools (current session):**
- Docs: Context7 available — use to ground the current Astro Actions testing API (action context / `callAction`) and React-island test setup during Phase 2/3 research; checked: 2026-06-15.
- Search: Exa.ai available — use for current-status discovery only, then prefer official docs; checked: 2026-06-15.
- Runtime/browser: Playwright MCP available — candidate for the single Phase 3 e2e only if integration cannot reach the drag→feedback loop; not used otherwise; checked: 2026-06-15.
- Provider/platform: Supabase tooling available — backs the integration-test database for Phases 2, 3, 4 (RLS, persistence); checked: 2026-06-15.

Use docs MCPs for current framework/library APIs and setup details. Use
search MCPs for discovery or current status only, then prefer official docs
as the evidence. Do not use MCP docs/search to infer code failure anchors;
those belong in per-phase `/10x-research`.

## 5. Quality Gates

The full set of gates that must pass before a change reaches production.
"Required after §3 Phase N" means the gate is enforced once that rollout
phase lands; before that, the gate is `planned`.

| Gate | Where | Required? | Catches |
|------|-------|-----------|---------|
| lint + typecheck (astro sync → eslint → build) | local + CI | required (already wired) | syntactic / type drift |
| unit + integration | local + CI | required after §3 Phase 1 | validator false-positives, boundary regressions |
| auth + RLS ownership integration | local + CI | required after §3 Phase 2 | unauthenticated mutation, cross-author PII access |
| drag→feedback e2e / island integration | CI on PR | required after §3 Phase 3 | broken drop-validation user path, lost work |
| new-validator-class parity fixture | CI on PR | required after §3 Phase 4 | a new collision class shipping without a false-positive guard |
| pre-prod smoke | between merge + prod | optional | environment-specific (workerd / Supabase) failures |

## 6. Cookbook Patterns

How to add new tests in this project. Each sub-section is filled in once the
relevant rollout phase ships; before that, it reads "TBD — see §3 Phase N."

### 6.1 Adding a unit test

- **Location**: a co-located `*.test.ts` sibling next to the source under test
  (e.g. `src/_pages/plan-detail/model/collision.test.ts`), matching the FSD
  slice convention — tests sit beside their source, never in a separate
  test-only directory.
- **Naming**: `<module>.test.ts`.
- **Reference test**: `src/_pages/plan-detail/model/collisions.test.ts` — the
  live Risk #1 independent-oracle example (hand-typed literal expectations, not
  values recomputed from the validator; see §3 Phase 1 for the
  student-collision false-positive pattern).
- **Run locally**: `pnpm test`.

### 6.2 Adding an integration test

**Standard pattern — plan-rooted ownership via the scenario factory** (`src/test/factories/`).
Every integration suite owns a fresh plan and tears it down; it never reads the shared
dev seed by name (a grep guard, `src/test/no-seed-coupling.test.ts`, fails CI if a
`Seed Plan A`/`Seed Plan B` lookup is reintroduced). This keeps the lane parallel-safe
by construction and resilient to a dev-DB exchange.

```ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/shared/api";
import { createPlan, seedPlanCatalog, teardown } from "@/test/factories";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const hasEnv = Boolean(SUPABASE_URL && SERVICE_KEY);

(hasEnv ? describe : describe.skip)("my feature (local Supabase)", () => {
  let supabase: SupabaseClient<Database>;
  let planId: string;

  beforeAll(async () => {
    if (!SUPABASE_URL || !SERVICE_KEY) return;
    supabase = createClient<Database>(SUPABASE_URL, SERVICE_KEY);
    planId = await createPlan(supabase);        // owned plan, registered for teardown
    await seedPlanCatalog(supabase, planId);    // real CSV catalog (both cohorts)
  });

  afterAll(async () => {
    await teardown(supabase);                   // cascade-deletes every owned plan
  });

  // ... drive the real domain functions against `planId` ...
});
```

- **Builders.** Input: `addAvailability`, `addMerge`, `addStudentWithChoices`. Output
  via the real domain functions (computed, not transcribed): `placeCourse`
  (`insertPlacement`), `ungroupSlot` (`insertOverride`), `computeGroupingsFor`
  (`computeAndPersistGroupings`). `seedPlanCatalog` returns the inserted rows for id lookups.
- **Externally-created plans** (e.g. a `clone_plan` result) — call `registerPlan(id)` so
  teardown reaps them too.
- **Run** with `pnpm test:integration` (needs the local stack: `supabase start` +
  `.env.test.local`, or `$GITHUB_ENV` in CI). Suites `describe.skip` locally when the
  env is absent; CI fails loudly via the `load-test-env.ts` gate.
- **Catalog source.** The factory seeds from the same `data/dp1|dp2` CSVs as the seed
  generator, through the shared `scripts/lib/catalog-transcode.mjs` (byte-identical-seed
  guarded) — so CSV-derived oracles (`adapter-parity`, `load`) stay valid.

### 6.3 Adding an e2e test

The reusable pattern shipped in §3 Phase 2 (`testing-auth-actions-boundary-rls`).
Copy it rather than reinventing:

- **Config:** root `playwright.config.ts` defines the project topology. Put the
  spec in `e2e/specs/`. Pick the project by what you're proving:
  - authenticated flow → name it `*.spec.ts` (runs under `chromium`, which
    reuses `e2e/.auth/user.json` via `storageState` — no per-test sign-in);
  - negative / unauthenticated flow (guard redirect, no-session Action) → name
    it `*guard.spec.ts` or `*unauth.spec.ts` (runs under `chromium-guard`, which
    starts with **no** cookies, so the real server-side gate is what rejects).
- **Auth reuse:** `e2e/auth.setup.ts` signs in once through the real UI and
  writes `storageState`; the author is provisioned idempotently by
  `scripts/provision-e2e-author.mjs` (the `pretest:e2e` hook), reading creds from
  the shared `e2e/author-credentials.mjs`.
- **Fidelity:** `webServer` runs `pnpm build && pnpm preview` on real **workerd**
  (not Vite dev) — the worker reads `SUPABASE_URL`/`SUPABASE_KEY` from `.dev.vars`
  (written by `pnpm env:local` locally; by the CI `e2e` job from the stack's
  minted keys). No sleeps / `networkidle`; gate on hydration and assertions
  (see the playwright-cli skill). Run with `pnpm test:e2e`.
- **Scope discipline:** prefer integration (`.handler`) for matrix-shaped truths;
  reserve e2e for genuinely browser-observable ones. The `createPlan` UI-driven
  happy-path mutation e2e and the cross-author/IDOR flow are **deferred** (the
  latter waits on the ownership-column + real-RLS prerequisite — see §3 notes).
- Drag → validate → feedback e2e is still §3 Phase 3 territory.

### 6.4 Adding a test for a new API endpoint

- TBD — see §3 Phase 2. The only remaining API routes are the auth session
  endpoints (`src/pages/api/auth/*`, kept for progressive enhancement); the
  placement/grouping hot path migrated to Astro Actions (see §6.5). Will cover
  the request parse → validate → respond contract for those auth endpoints and
  server-side re-validation of untrusted input.

### 6.5 Adding a test for a new Astro Action

- TBD — see §3 Phase 2. Will cover `requireSession` enforcement, the
  `DomainError`→`ActionError` translation, and persistence under RLS —
  without re-testing the already-covered `src/_pages/courses/api` domain logic.

### 6.6 Per-rollout-phase notes

(Optional. After each phase lands, `/10x-implement` appends a 2–3 line note
here capturing anything surprising the rollout phase taught.)

## 7. What We Deliberately Don't Test

Exclusions agreed during the rollout (Phase 2 interview, Q5). Future
contributors should respect these unless the underlying assumption changes.

- **shadcn/ui primitives (`src/shared/ui/*`)** — vendored library code;
  the library is the test, and the high churn here is mostly CLI
  regeneration. Re-evaluate only if a primitive is hand-modified with real
  logic. (Source: Phase 2 interview Q5.)
- **Marketing / static pages (`Welcome.astro`, `index`, static layout)** —
  low blast radius and break loudly and visibly. Re-evaluate if a static
  page gains real logic. (Source: Phase 2 interview Q5.)
- **Generated Supabase types (`database.types.ts` and other generated
  artifacts)** — the generator is the test. Re-evaluate if types are
  hand-edited. (Source: Phase 2 interview Q5.)
- **The grouping core (`src/_pages/plan-detail/model/compute-groupings.ts`)** —
  already guarded by parity tests (`src/_pages/plan-detail/api/parity.test.ts`)
  against the original CSV pipeline output; do not re-litigate it. Re-evaluate
  only if the parity oracle is found to mirror the implementation. (Source:
  Phase 2 interview Q5.)

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-06-15
- Stack versions last verified: 2026-06-15
- AI-native tool references last verified: 2026-06-15

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes,
- the anticipated architecture refactor (§1 principle #4) lands and shifts
  the stable boundaries the rollout pins. **(Resolved 2026-06-15: the FSD
  refactor landed and this refresh re-anchored the boundaries.)**
