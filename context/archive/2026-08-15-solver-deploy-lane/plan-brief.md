# Solver Deploy Lane (S-302) — Plan Brief

> Full plan: `context/changes/solver-deploy-lane/plan.md`
> Research: `context/changes/solver-deploy-lane/research.md`

## What & Why

Ship the CP-SAT solver as a Cloudflare Container attached to the existing Worker so that **one merge to `main` deploys app + solver together** (FR-315), give the developer machine the three local fidelity tiers (FR-316), and add a one-command **hosted-solve campaign** — local app + native solver against the hosted database — so plan/policy variations can be tested on real data fast and for free. It is the head of the platform-proof track (S-302 → S-304 → S-308).

## Starting Point

F-302 built the transport seam cleanly (`SolverTransport` factory, `getSolverTransport()` selector, injected at the Actions root), so production is a factory-input swap. The hard part is elsewhere: the Worker entry is framework-owned and a container must be fronted by a DO class exported from it — spiked and cleared 2026-08-16. There is no Dockerfile, no `.dockerignore`, no container config, no mise image tasks; the CI `deploy` job ships only the Worker; the hosted Custom Access Token Hook and machine user are not yet enabled.

## Desired End State

Push to `main` → CI green → `deploy` builds/pushes the linux/amd64 image and deploys Worker + `SolverContainer` (`standard-4`, `EEUR`, `max_instances 1`, `sleepAfter 30m`, `SOLVER_WORKERS=4`). Generate dispatches through the binding in production and through `SOLVER_URL` locally (URL always wins). `mise run solver:image:*` (tier 2), `solver:tier3`, and `solver:hosted` exist; `pnpm dev`/`preview` never touch Docker. The solver refuses a token whose role is not `solver_job_writer`. Docs match reality.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Worker entry | Project-owned `src/worker.ts` re-exporting `handle` + `SolverContainer` | Only way to export the DO class; spiked, builds, treeshake-safe, dry-run OK | Research |
| Typing | Hand-written `src/cloudflare-env.d.ts`, never `wrangler types` | `wrangler types` shadows DOM globals in React islands | Research |
| Path filtering | None; `deploy.needs` untouched | 44 s job vs 426 s critical path; the gate rewrite is the riskiest line in the repo | Change notes |
| `SOLVER_WORKERS` | `4`, explicit in container `envVars` | 4 vCPU ceiling; the failure mode is `8` inheriting silently | Change notes |
| Rollback | Roll-forward-only policy, no empirical test | DO migration blocks `wrangler rollback`; action is identical either way | Change notes |
| Doc truth-up | In scope (FR-315/316, cost ~$15, containers#162, tier 3, README) | Slice makes those claims false; precedent from `clean-up-bench-generation` | Change notes |
| Hosted-solve mode | `.envs/prod-solver.vars` + `pnpm env:prod-solver` + `mise run solver:hosted` (caffeinate, restore `env:local`) | Named opt-in profile; `prod.vars` stays read-only; one friendly command | Change notes / Plan |
| `sleepAfter` | `30m`, explicit stopgap | Dispatch is 202-and-detach so nothing keeps the container awake during a 12.5-min solve; S-304 owns the real fix | Plan |
| Binding proof | Unit-test the seam with fakes; real binding via tier 3 + first deploy | No `vitest-pool-workers` detour; E2E → S-306 | Plan |
| Fail closed | Solver asserts `role == solver_job_writer` at sign-in | Missing hook otherwise fails *upward* to `authenticated` | Plan |
| Image scanning | Deferred; recorded gap; tag-pinned base | Keeps the slice on its critical path | Plan |
| Tier 3 | `dev.enable_containers: false`; opt-in `wrangler dev --enable-containers` post-build | Daily preview and the campaign must stay Docker-free | Plan |
| Cold start | `startAndWaitForPorts` (45 s, measured) then POST with the existing 15 s | Distinguishes "not up" from "refused"; URL path untouched | Plan |
| Gate order | Complete the manual hosted gate before merging; single PR | First container start has a correct credential; one squash = one deploy | Plan |
| Secrets | Reuse `SUPABASE_URL/KEY` + new `SOLVER_MACHINE_PASSWORD` Worker secret via `envVars` | One new secret, no new privilege | Plan |

## Scope

**In scope:** role assertion; Dockerfile + `.dockerignore` + mise image build/smoke; Worker entry, `SolverContainer`, ambient types, `wrangler.jsonc` container config; binding transport + selector + unit tests; `prod-solver` profile, `solver:hosted`, `solver:tier3`; CI deploy building/pushing the image; doc truth-up; manual hosted gate; first deploy + production smoke.

**Out of scope:** path filters, layer caching (measure first), rollback experiments, E2E (S-306), job-aware lifecycle (S-304), image scanner, Secrets Store, egress hardening, `wrangler types`, editing `prod.vars`.

## Architecture / Approach

`src/worker.ts` exports Astro's `handle` + `SolverContainer extends Container` (port 8000, `sleepAfter 30m`, `envVars` forwarding Worker secrets + `SOLVER_WORKERS=4`). `wrangler.jsonc` declares `containers` (Dockerfile at `services/solver/Dockerfile`, build context repo root, `standard-4`, `EEUR`), the `SOLVER` DO binding, a `new_sqlite_classes` migration, and `dev.enable_containers: false`. `getSolverTransport()`: `SOLVER_URL` → URL transport; else `env.SOLVER` → `createBindingSolverTransport(getContainer(...))`; else `null`. The image preserves `<root>/services/solver` beside `<root>/contracts` so `parents[4]` resolves the schema. CI's `deploy` runs the same single `wrangler deploy`, which now builds/pushes the image on the runner's Docker.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Solver hardening + image (tier 2) | Role assertion; Dockerfile/.dockerignore; `solver:image:build/smoke` → 202 | `contracts/` layout fails open (smoke must POST) |
| 2. Worker entry + binding + selector | `src/worker.ts`, `SolverContainer`, ambient types, wrangler config, transport + tests | Type shadowing; client bundle pulling `cloudflare:workers` |
| 3. Local modes | `env:prod-solver`, `solver:hosted`, `solver:tier3`, README tiers | `wrangler dev` through the config redirect unverified (fallback documented) |
| 4. CI deploy lane | `deploy` builds/pushes image; comment truth-up | Docker/daemon visibility from `wrangler-action`; token 403 |
| 5. Doc truth-up | PRD/roadmap/CLAUDE.md/README/runbook/foundation docs | Missing a stale claim |
| 6. Manual hosted gate | Hook, machine user, claim verified, Worker secret, token scope, first campaign | Human step skipped → fails closed thanks to Phase 1 |
| 7. Merge + production smoke | First container deploy; measurements recorded | Cold-start budget; deploy wall-clock growth |

**Prerequisites:** Docker Desktop with amd64 buildx (present); Cloudflare account access to widen the token; hosted Supabase dashboard + service-role key for provisioning; `dobrek` gh account for the PR.
**Estimated effort:** ~4–5 sessions across 7 phases (Phase 6 is human-paced).

## Open Risks & Assumptions

- `wrangler dev` through `.wrangler/deploy/config.json` with `.dev.vars` is assumed to work for tier 3 — verified first thing in Phase 3, with a documented fallback.
- `Containers: Edit` token scope is evidence-backed, not doc-stated; `Cloudchamber: Edit` is the fallback if the deploy 403s.
- Cold-start and deploy wall-clock numbers are unknown until Phase 7; both constants/decisions are explicitly "measure then adjust".
- `sleepAfter 30m` is a stopgap: jobs longer than 30 min still die silently until S-304.
- The hosted-solve campaign writes to production; a sleeping laptop can still wedge a `running` row until S-304 widens the claim CAS (`caffeinate` mitigates).

## Success Criteria (Summary)

- One merge to `main` deploys Worker + container; a production Generate on a scratch plan completes through the binding.
- Local: preview stays Docker-free; `solver:image:smoke` → 202; `solver:tier3` reaches the container; `solver:hosted` runs a hosted job from a laptop in one command.
- Docs (PRD FR-315/316, roadmap, CLAUDE.md, README rollback/CI, runbook) describe what actually shipped.
