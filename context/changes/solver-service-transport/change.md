---
change_id: solver-service-transport
title: Solver service transport
status: impl_reviewed
created: 2026-08-11
updated: 2026-08-11
archived_at: null
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

### Decisions

- **2026-08-11 — Zero schema edit for the solve request; F-302 ignores `policy`.**
  `POST /jobs/{jobId}/solve` carries an unmodified `SolveRequest`; `jobId` travels in the URL path
  (the body is `additionalProperties: false`). F-302 does **not** read `policy` — it solves the
  canonical order and records status/results; the app writes `policy` to the job row for the audit
  trail and **S-307** owns making the solver honour it. So the wrapper needs no DB read path for the
  solve itself, only the status/result writes.
  `contracts/generation-wire.schema.json` is **not** touched by F-302 — no `formatVersion` bump, no
  golden regeneration. Rejected alternative: `policy?` as an additive-optional property (also
  bump-free, but policy already lives in `generation_jobs.policy jsonb not null`, so a second copy
  could disagree — one authoritative home is better). See `research.md` §R2.
- **2026-08-11 — `mypy --strict` lands in F-302, as an early phase.** Not deferred again to S-302.
  The gate goes in **before** the HTTP wrapper, so the new module is written under it rather than
  retrofitted. Scope: `src/` strictly; `tests/` (38 more, needs `types-jsonschema` + a `py.typed`
  marker or `mypy_path`) only if it stays cheap. `cli.py` cannot be skipped — the goldens-regen
  script depends on it. See `research.md` R7.
- **2026-08-11 — `Term = cp_model.LinearExpr | int`.** Not a design decision: `Term = object`
  (`model.py:53`) was a placeholder whose own comment names the fix, one notch too narrow
  (`IntVar` subclasses `LinearExpr`). Measured on a scratch copy: **70 → 46 errors from one line**,
  every `operator` error gone, runtime-verified on 3.13. Pair with `Sequence[Term]` (not
  `list[Term]`) in ~4 helper signatures to clear the residual list-invariance errors. No `cast()`s.
  See `research.md` §8.1 / R8.
- **2026-08-11 — Pin Python 3.13 everywhere.** `requires-python = ">=3.13"`, `.python-version` stays
  3.13, image base becomes `python:3.13-slim` when S-302 writes it. Rationale: uv reads
  `.python-version`, so local and CI already run 3.13 — leaving the image at 3.12 would mean testing
  on 3.13 and shipping 3.12. See `research.md` R9.
- **2026-08-11 — Idempotency guard: two layers, both free.** (a) the `jobId → (thread, CpSolver
handle)` registry doubles as the in-process guard; (b) the mandatory `status → 'running'` write
  becomes a compare-and-set (`WHERE id = ? AND status = 'queued'`), proceeding only if it affected a
  row — this survives the container restart that clears the registry. The RLS `WITH CHECK` window
  permits `running → running`, so the guard must be the `status = 'queued'` filter, not the policy.
  See `research.md` R10.
- **2026-08-11 — Hosted hook enablement is S-302's, not F-302's; stays manual.** F-302 needs no
  hosted setup — the Custom Access Token Hook is already enabled in `supabase/config.toml`, which the
  CI `integration` job boots, and F-302 is local-fidelity tier 1 throughout. The hosted `config push`
  - machine-user provisioning gate the first _hosted_ container run (S-302), and must stay manual:
    `config push` rewrites the whole hosted `config.toml`, and provisioning needs a service-role key CI
    deliberately does not hold. **Absence fails upward** — no hook means the machine user falls back to
    `authenticated` and reaches the whole database with no error — so verifying the token decodes to
    `solver_job_writer` is a gate before the first hosted run. The runbook's single "Checklist for
    F-302" was split into F-302 (container behaviour) and S-302 (hosted enablement) sections. See
    `research.md` §5.1.
- **2026-08-11 — Flagged for later: S-307 is under-scoped.** The engine cannot accept a policy today
  — tier order is a hardcoded tuple, `solve_staged` hardcodes `range(1, 10)`, `SolveConfig` has no
  policy field, and clean mode (FR-302's _shipped default_) is unimplemented. Not F-302 work; see
  `research.md` §1.1.
- **2026-08-11 — CP-SAT is not implemented as a second `GeneratePlan`.** The port stays untouched;
  dispatch is a separate transport function, and `runVerifiedGeneration` is applied on the
  result-read side. See `research.md` §6.

- **2026-08-11 — the solve endpoint is unauthenticated and unbound to the row; the deployment
  boundary is the whole mitigation.** Recorded during `/10x-impl-review` (F3), because nothing in the
  plan, research or either README said it out loud and S-302 would otherwise inherit it blind.
  `POST /jobs/{jobId}/solve` takes no caller credential, and the engine solves the snapshot in the
  **body** while writing onto the job named in the **path** — `snapshot_hash` is never read, so a
  caller who knows a live job UUID can plant a board whose row-hash still describes a different
  input. This mirrors the posture the credential migration already takes one layer down (`Solver
reads any job … using (true)`, narrowed by S-301). Safe today because of _where the port is_:
  loopback in dev, and a Cloudflare container binding — not a routable URL — in production, which is
  what S-302 must preserve. Two things landed with the decision: the handler now requires
  `Content-Type: application/json` (415 otherwise), which forces a preflight this service never
  answers and so closes the one browser-side path; and the trust boundary is written down in
  `services/solver/README.md`. **The snapshot binding itself is S-301's**, alongside the result-read
  drift check — compare the row's `snapshot_hash` against `canonical_snapshot_json` of the body's
  snapshot after a successful claim.

### Found during implementation

- **2026-08-11 — the `entities/timetable` barrel must stay client-safe; `solver-config.ts` is NOT in
  it.** The plan said to export both the factory and the env-reading module through the barrel.
  `pnpm build` refused: that barrel is pulled into the Web Worker bundle
  (`_pages/plan-detail/model/generation/generate.worker.ts`), and Astro's env plugin throws
  `[ServerOnlyModule]` at **load** time — before tree-shaking could drop an unused export — so one
  server-only module in it fails the build outright. Resolution: the barrel exports
  `api/solver-transport.ts` (pure) only; server-side callers reach `api/solver-config.ts` at its own
  path, exactly as `createClient` in `shared/api` is reached. **S-301 imports
  `@/entities/timetable/api/solver-config` directly.** The plan's env-isolation design is unchanged
  and is now enforced by the build rather than by convention.
- **2026-08-11 — a full-catalog solve is ~12.5 minutes, not seconds.** Measured end to end against
  the local stack (12:32:39 → 12:45:07 on the golden). Mode A completeness is ~0.7 s as researched,
  but `solve_complete` then chains all ten tiers at `SolveConfig.stage_budget_s = 120` each. Not a
  defect and not calibrated here (S-308 owns budgets) — but it is why the proof-of-life test drives a
  small builder snapshot rather than the golden, and it is worth knowing before S-303 designs
  progress reporting.
- **2026-08-11 — uvicorn leaves the root logger at WARNING.** It configures only its own `uvicorn.*`
  loggers, so every `log.info` in `cpsat_service` was silently dropped on the first real run. That
  contradicted the design's documented fallback: the lost-compare-and-set and sign-in-failure paths
  write **nothing to the row**, so the service log is their entire trace. Fixed with
  `logging.basicConfig` at app import (`SOLVER_LOG_LEVEL`, default INFO) and the lost-claim line
  raised to WARNING; pinned by a `caplog` assertion.
- **2026-08-11 — `SolveRequest` lives in `wire.ts`, not `types.ts`.** The plan put the type in
  `types.ts` alongside the other projections. It landed in `wire.ts` because it carries a
  `WireSnapshot`, which is defined there — putting the type in `types.ts` would have made `types.ts`
  import from `wire.ts` purely to name one field, inverting which module owns the wire pin. The
  canonicalizer was always going to live in `wire.ts` regardless, so the two stay together. Both
  reach the barrel through the existing `export * from "./model/generation/wire"` line, so nothing
  downstream sees the difference. (Recorded during `/10x-impl-review` — F9.)

- **2026-08-11 — `.env.example` and `.envs/*` are gitignored** (`.gitignore:34-35`), so the plan's
  edits to them cannot ship. `SOLVER_URL` is documented where a fresh clone actually creates those
  files — the README's Getting Started heredoc.
