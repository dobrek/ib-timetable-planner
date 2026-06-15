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
   codebase is early and substantially LLM-generated. The structural refactor
   this principle anticipated **has since landed** (archived
   `2026-06-08-architecture-refactor`, 5 phases): a pre-existing behavioral
   net held green through the FSD relocation, and the base has grown from a
   15-test baseline to **55 unit + 9 integration** since. Every test the
   rollout adds must assert **observable behavior at a stable boundary** — the
   validator's verdict, the user-visible drop feedback, auth/RLS enforcement,
   persistence durability — the contracts that survive a refactor. Tests must
   **never** mirror internal structure that is liable to move. If a test would
   have to change purely because internals were reshaped and no behavior
   changed, it is the wrong test. This is the direct answer to interview Q2
   and the convention the §3 Phase 4 parity gate enforces.

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
| 1 | The validator marks a placement **valid that actually collides** for a student (the shipped student-collision class) — the author trusts and ships a broken timetable. | High | High | PRD §Guardrails L57 (no wrong-positive); interview Q1; FSD evidence dir `src/_pages/plan-detail/{model,api}` |
| 2 | The **drag → action → grid feedback loop renders the wrong verdict** — an optimistic UI keeps showing "valid" after the server returns invalid, so the user never sees the collision. | High | High | interview Q3 + Q4; FSD evidence dir `src/_pages/plan-detail/{ui,api}` |
| 3 | A **server-mutation boundary diverges from its tested core** — every app-data mutation/compute now flows through Astro Actions (`src/actions/` barrel over `_pages/*/api/` handlers; the placements/grouping API route was migrated away). Untested at the **wrapper-over-a-real-HTTP-`/_actions/*`-request** layer: broken auth enforcement, wrong `DomainError`→`ActionError` translation, failed persistence, off-contract response, or no server-side re-validation of untrusted input. | High | Medium | interview correction (Actions are now the sole mutation transport); test base: the wrapper contract is unit-tested but no integration test invokes a real Action over HTTP; lessons.md Actions-only rule |
| 4 | **Placed work is lost** — a placement does not survive reload/crash, or a write is silently dropped, violating the work-durability promise. | High | Medium | PRD NFR Work durability L130; FSD evidence dir `src/_pages/plan-detail/api` |
| 5 | **Unauthenticated or cross-author access to student PII or the catalog** — an RLS ownership gap, or an Astro Action handler missing `requireSession()` (the `/_actions/*` path is exempt from the middleware redirect by convention, so the gate is per-handler). *(abuse: authorization / IDOR)* | High | Medium | PRD NFR Data privacy L131, Access Control L158; Actions self-enforce auth (interview correction + `src/actions` convention); auth untested; FSD evidence dir `src/_pages/sign-in/ui`, `src/pages/auth` |
| 6 | **Cross-cohort teacher collision passes as valid** (S-09) — *refresh inference, not yet live:* if/when the cross-cohort teacher-constraint class ships (roadmap S-09, currently `blocked` on prereq S-08), the validator could mark a Y2 placement valid that reuses a teacher already occupied in Y1 — a new false-positive class under the L57 no-wrong-positive guardrail. | High | Medium | refresh inference grounded in roadmap S-09 (L226–238) + PRD L57; **no code anchor** — class not built (`types.ts:15` carries only a design-note comment). Not testable until S-09 ships; response is the §3 Phase 4 parity gate. |

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
| #6 / S-09 | *(not testable until the class ships)* When the cross-cohort teacher class lands, a fixture reusing a Y1-occupied teacher in Y2 is **rejected**; a non-reusing placement is accepted — guarded by the §3 Phase 4 parity harness as the class is added. | "the in-cell teacher check already covers this" — it does not; today's `teacher-conflict` is single-cell only, with no cohort dimension. | The new constraint's cohort dimension and `BoardContext` field; the parity oracle's expected values (from requirements, not the new code). | unit (parity fixture) once the class exists. | Shipping the new class without a false-positive parity guard; lifting the oracle's expected values from the new validator's own code. |

## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder
via `/10x-new`. Status moves left-to-right through the values below; the
orchestrator updates Status as artifacts appear on disk.

| # | Phase name | Goal (one line) | Risks covered | Test types | Status | Change folder |
|---|------------|-----------------|----------------|------------|--------|----------------|
| 1 | Validator trust core + API hot-path boundary | Prove a false-positive cannot pass the core or the `placements`/`grouping` API route. | #1, #3 (API-route half) | unit (harden core, independent oracle) + integration (route) | change opened | context/changes/testing-validator-trust-core/ |
| 2 | Drag → validate → feedback loop + persistence | Prove a real collision visibly reads "invalid" and placed work survives reload. | #2, #4 | component / integration (planner island); persistence integration; ≤1 e2e | not started | — |
| 3 | Auth + Astro Actions boundary + RLS / PII | Prove every Action self-enforces session, no cross-author read, and error translation holds. | #5, #3 (Actions half) | integration (local Supabase + auth) | not started | — |
| 4 | Quality-gate: parity harness for new validator classes | Lock a convention + fixture harness so future validator classes (roadmap S-03, S-09) ship with parity guards. | cross-cutting (forward-proof; interview Q2) | gates + table-driven fixture harness | not started | — |

**Status vocabulary** (fixed — parser literals): `not started` → `change
opened` → `researched` → `planned` → `implementing` → `complete`.

## 4. Stack

The classic test base for this project. AI-native tools (if any) carry a
`checked:` date so future readers can see which lines need re-verification.

| Layer | Tool | Version | Notes |
|-------|------|---------|-------|
| unit | Vitest | (see lockfile) | `vitest.config.ts`; 15 test files today, 13 concentrated in `src/lib` (grouping, planner, placements, courses, schemas). |
| integration | Vitest | (see lockfile) | `vitest.integration.config.ts`; requires the local Supabase stack running (`pnpm test:integration`). Must exercise **both** Astro Actions (via Astro's action context / `getActionContext`) and API routes. |
| e2e | none yet — see Phase 2 | — | At most one e2e for the drag→feedback loop, only if integration cannot reach it; Playwright MCP is available as the runner. |
| edge runtime | n/a | — | Code runs on Cloudflare Workers (workerd) in dev and prod — edge-safe libs only, no Node APIs (`fs`, `child_process`, native). |

**Stack grounding tools (current session):**
- Docs: Context7 available — use to ground the current Astro Actions testing API (action context / `callAction`) and React-island test setup during Phase 2/3 research; checked: 2026-06-08.
- Search: Exa.ai available — use for current-status discovery only, then prefer official docs; checked: 2026-06-08.
- Runtime/browser: Playwright MCP available — candidate for the single Phase 2 e2e only if integration cannot reach the drag→feedback loop; not used otherwise; checked: 2026-06-08.
- Provider/platform: Supabase tooling available — backs the integration-test database for Phases 1, 3, 4 (RLS, persistence); checked: 2026-06-08.

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
| drag→feedback e2e / island integration | CI on PR | required after §3 Phase 2 | broken drop-validation user path, lost work |
| auth + RLS ownership integration | local + CI | required after §3 Phase 3 | unauthenticated mutation, cross-author PII access |
| new-validator-class parity fixture | CI on PR | required after §3 Phase 4 | a new collision class shipping without a false-positive guard |
| pre-prod smoke | between merge + prod | optional | environment-specific (workerd / Supabase) failures |

## 6. Cookbook Patterns

How to add new tests in this project. Each sub-section is filled in once the
relevant rollout phase ships; before that, it reads "TBD — see §3 Phase N."

### 6.1 Adding a unit test

- **Location**: a `__tests__/` directory next to the unit under test (e.g.
  `src/lib/placements/__tests__/`), matching the existing `src/lib`
  convention.
- **Naming**: `<module>.test.ts`.
- **Reference test**: `src/lib/placements/__tests__/validate.test.ts`
  (Phase 1 hardens its oracle independence — see §3 Phase 1 for the
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

- TBD — see §3 Phase 2 (drag → validate → feedback loop).

### 6.4 Adding a test for a new API endpoint

- TBD — see §3 Phase 1. Will cover the `src/pages/api/*` hot-path contract
  (request parse → validate → persist → valid/invalid response) and
  server-side re-validation of untrusted input.

### 6.5 Adding a test for a new Astro Action

- TBD — see §3 Phase 3. Will cover `requireSession` enforcement, the
  `DomainError`→`ActionError` translation, and persistence under RLS —
  without re-testing the already-covered `src/lib/courses` domain logic.

### 6.6 Per-rollout-phase notes

(Optional. After each phase lands, `/10x-implement` appends a 2–3 line note
here capturing anything surprising the rollout phase taught.)

## 7. What We Deliberately Don't Test

Exclusions agreed during the rollout (Phase 2 interview, Q5). Future
contributors should respect these unless the underlying assumption changes.

- **shadcn/ui primitives (`src/components/ui/*`)** — vendored library code;
  the library is the test, and the high churn here is mostly CLI
  regeneration. Re-evaluate only if a primitive is hand-modified with real
  logic. (Source: Phase 2 interview Q5.)
- **Marketing / static pages (`Welcome.astro`, `index`, static layout)** —
  low blast radius and break loudly and visibly. Re-evaluate if a static
  page gains real logic. (Source: Phase 2 interview Q5.)
- **Generated Supabase types (`database.types.ts` and other generated
  artifacts)** — the generator is the test. Re-evaluate if types are
  hand-edited. (Source: Phase 2 interview Q5.)
- **The grouping core (`src/lib/grouping`)** — already guarded by parity
  tests against the original CSV pipeline output; do not re-litigate it.
  Re-evaluate only if the parity oracle is found to mirror the
  implementation. (Source: Phase 2 interview Q5.)

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-06-08
- Stack versions last verified: 2026-06-08
- AI-native tool references last verified: 2026-06-08

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes,
- the anticipated architecture refactor (§1 principle #4) lands and shifts
  the stable boundaries the rollout pins.
