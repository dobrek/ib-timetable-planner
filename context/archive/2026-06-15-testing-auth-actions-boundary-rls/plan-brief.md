# Auth + Astro Actions Boundary (+ RLS/PII) Tests — Plan Brief

> Full plan: `context/changes/testing-auth-actions-boundary-rls/plan.md`
> Research: `context/changes/testing-auth-actions-boundary-rls/research.md`

## What & Why

Rollout **Phase 2** of the test plan: prove the auth + Astro Actions boundary (Risks #5 unauth and #3 mutation-boundary) and, in doing so, stand up the project's **first Playwright e2e harness** as the reusable pattern for all future browser-level tests. The boundary matters because `/_actions/*` is exempt from the middleware redirect — the gate is per-handler `requireSession`, and "logged in" is the only thing currently provable ("authorized for this row" awaits RLS).

## Starting Point

The action layer is uniform (one factory, `defineDomainAction`, gates every action) and unit-tested, and there's a mature Vitest integration lane with a factory harness + CI job. But e2e tooling is greenfield: only `@playwright/cli` (an agent aid) exists — no `@playwright/test`, no config, no `e2e/` dir. A real "New plan" UI flow exists to drive the happy path.

## Desired End State

`pnpm test:e2e` runs locally and in a new CI job against a **real workerd preview**, proving: a signed-in author reuses the persisted session (`storageState`) and lands on the protected dashboard; unauthenticated page → redirect; no-session action → `UNAUTHORIZED` over real HTTP. A `GRANT … TO authenticated` migration pins table reachability. A Vitest integration complement proves the `DomainError`→`ActionError` matrix (in-scope codes), malformed-input rejection, and `createPlan` persistence. The first e2e is deliberately scoped to authentication + the reusable harness — driving a mutation through the UI (the `createPlan` happy-path round-trip) is deferred to a later browser test. The `e2e` CI job gates deploy.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| e2e vs integration | Hybrid split | e2e owns browser-observable truths; Vitest owns the matrix-shaped ones | Research |
| First e2e scope | Auth + harness only | This change sets the stage + verifies authentication; UI-driven mutation e2e (`createPlan` round-trip) is deferred to a later browser test | Review |
| Test runner | `@playwright/test` | The actual runner; `@playwright/cli` stays the authoring/healing aid | Research |
| RLS / cross-author | Testable-today only | Cross-author/IDOR needs an ownership column + real RLS — deferred | Research |
| webServer fidelity | Build + preview (workerd) | The boundary only behaves correctly on real workerd, not Vite-emulated dev | Plan |
| Test author | Idempotent script, shared fixed creds | No secret to rotate; admin API bypasses `enable_signup=false`; one creds module shared by the script + setup spec | Plan |
| Table reachability | **Pin `GRANT … TO authenticated` migration** | The dropped happy-path e2e was the only authenticated DB write, so nothing would auto-catch a grant regression — pin reachability at the schema level instead | Review |
| Integration scope | Testable-today complement (matrix + malformed input + persistence) | Close Risk #3's matrix where it belongs, honoring the hybrid; no-session path is unit + e2e covered, not re-mirrored | Plan |
| Browsers | Chromium only | Server-side boundary doesn't vary by engine; fastest, least flake | Plan |
| Deploy gate | e2e blocks deploy | A broken auth/action boundary can't ship | Plan |
| test-plan.md | Amend §3 + §6.3 | Keep the foundation doc truthful about the Phase-2 divergence | Plan |

## Scope

**In scope:** Playwright harness (config, `e2e/` dir, setup spec, shared creds module); 3 e2e specs (auth load, guard redirect, action unauth); a `GRANT … TO authenticated` reachability migration; idempotent provisioning script; Vitest integration complement; new CI `e2e` job + deploy gate; `.gitignore` + doc updates.

**Out of scope:** cross-author/IDOR; ownership column / non-permissive RLS; the `createPlan` happy-path e2e (UI-driven mutation round-trip — deferred); drag-drop e2e; cross-browser; an "action over HTTP" Vitest harness; re-testing covered domain logic.

## Architecture / Approach

Top-level `e2e/` dir (invisible to steiger + Vitest). Root `playwright.config.ts` with three projects: `setup` (logs in once → `storageState`), `chromium` (authenticated, depends on setup), `chromium-guard` (no cookies, for negative/unauth specs). `webServer` runs `pnpm build && pnpm preview` for true workerd fidelity. A Node provisioning script seeds the author via the admin API, sharing a fixed-default creds module (`e2e/author-credentials.mjs`) with the setup spec. A `GRANT … TO authenticated` migration pins table reachability (current + future tables). The CI `e2e` job mirrors the existing `integration` job and writes `.dev.vars` from the CI stack's minted keys (the anon-key-mismatch fix — CI does not rely on `webServer.env`). Integration complement reuses the factory harness at the `.handler` layer.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Harness scaffold + provisioning + reachability pin | Runner, config, `e2e/`, provisioning script, login setup spec, GRANT migration | Env-to-worker wiring (workerd reads `.dev.vars`, not `webServer.env`) |
| 2. E2e assertion specs | Auth load, guard redirect, action unauth | Action-error HTTP shape; input-error precedence on the unauth assertion |
| 3. Integration complement | Translation matrix + unauth `.handler` + malformed input | Adding the `astro:actions` alias to the integration config |
| 4. CI e2e lane + deploy gate | New `e2e` job; deploy gated on it | CI anon-key mismatch; build+preview boot time / flake |
| 5. Docs + close-out | Amend test-plan.md §3/§6.3, runbook, stamp change.md | Doc drift vs what actually shipped |

**Prerequisites:** local Supabase running; `pnpm env:local`; existing factory harness + CI integration lane (already in place).
**Estimated effort:** ~3–4 sessions across 5 phases (Phase 1 carries the riskiest wiring; Phases 3–5 are smaller).

## Open Risks & Assumptions

- **Env-to-worker mechanism** (research Open Q1) — whether `webServer.env` reaches workerd or `.dev.vars` is required; resolved empirically in Phase 1 (local) and Phase 4 (CI).
- **CI anon-key mismatch** — the CI stack mints keys that differ from the fixed local publishable key; `.dev.vars` must be written from the CI stack's keys or sign-in fails silently.
- **Table reachability** — pinned via a `GRANT … TO authenticated` migration (current + future tables), so a Supabase flip to opt-in grants can't silently break the app; risk retired (previously relied on auto-grant + an e2e write to catch regressions, both removed when the happy-path spec was dropped).
- **New-harness flake** blocking deploy — mitigated by chromium-only + `retries: 1`; revisit policy after the lane has history.

## Success Criteria (Summary)

- `pnpm test:e2e` green locally and in CI: a signed-in author reuses the persisted session and loads the protected dashboard, an unauthenticated visitor is bounced, and a no-session action is refused with `UNAUTHORIZED` over real HTTP.
- `pnpm test:integration` green: the `DomainError`→`ActionError` matrix (in-scope codes: `CONFLICT`, `NOT_FOUND`), malformed-input rejection, and `createPlan` persistence proven against real Supabase.
- The `e2e` CI job gates deploy; foundation docs reflect the Phase-2 e2e harness.
