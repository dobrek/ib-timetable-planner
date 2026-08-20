---
change_id: solver-deploy-lane
title: Solver deploy lane
status: archived
created: 2026-08-15
updated: 2026-08-20
archived_at: 2026-08-20T12:01:58Z
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

### 2026-08-18 — Impl review: 0 critical / 4 warnings / 5 observations, all nine fixed.

Report: `reviews/impl-review.md`. The one with teeth is **F1**: an unconfigured solver used to
*accept* a job (202) and wedge it at `queued`; `solve` now refuses with a **503** when
`settings.configured` is false, so the caller's existing compensation marks the row `failed` and
deletes the clone. `/health` still answers bare. This retires the "missing `SOLVER_MACHINE_PASSWORD`
wedges production silently" residual — it now fails loudly per Generate instead. README, `mise.toml`
and the runbook were truthed-up to match.

The rest: `solver:hosted` refuses when :8000 is already bound and bails when its solver dies
(F2, closes the "hosted rows dispatched to a local solver" path); the profile is read with `sed`
rather than executed as shell, and tier 3 writes the password single-quoted, refusing `'`/newline
(F3 — the bundled dotenv cuts unquoted values at `#` and never unescapes `\'`); both
`instanceGetTimeoutMS` and `portReadyTimeoutMS` now carry the 45 s budget (F4 — the library's
get-instance default is only 8 s); the +37 s / 5.5 s measurements are written into the ci.yml and
transport comments (F5); `.gitignore` covers `.dev.vars*` (F6); `withTimeout` clears its timer (F7);
`.dockerignore` re-includes `services/solver` only and drops `node_modules`/`.astro`/`tests` — the
context now holds exactly `contracts/` + `src`, `pyproject.toml`, `uv.lock`, `.python-version`,
`README.md`, `Dockerfile` (F8); `onStop` uses the package's `StopParams` (F9).

### 2026-08-17 — Phase 2: bundle delta lands at +54.85 KiB, over criterion 2.6's "< 50 KiB". Accepted.

**Measured against HEAD, not inherited.** Worker upload 3788.02 → **3842.87 KiB** (+54.85 KiB;
gzip 864.91 → 880.60, +15.69). The **client bundle is byte-identical** — 1308 KiB across 29 files
before and after, and `grep` finds no `cloudflare:workers`, `@cloudflare/containers`,
`startAndWaitForPorts` or `SolverContainer` anywhere under `dist/client/`.

**Accepted rather than fixed** (author decision, 2026-08-17). Essentially the whole delta is
`@cloudflare/containers` itself (72 KiB of unminified source); the four new modules are 13 KiB of
source, mostly comments. There is no lever short of vendoring a trimmed subset of the package, which
would trade a supported dependency for hand-maintained platform code. In context the number is
1.4% of a script with a 10 MB paid ceiling and a 7 MB self-imposed yellow line.

**The criterion was measuring the wrong bundle.** Its argument (Critical Details, "Client bundle")
is entirely about keeping `cloudflare:workers` and `@cloudflare/containers` unreachable from
`entities/timetable/index.ts` — that came out at exactly zero, because the binding transport takes a
structural `ContainerLike` and its only package import is `import type`. A future threshold should
be stated against `dist/client`, where it can actually regress.

### 2026-08-18 — Production smoke: the numbers, from the container's own log export.

Job `386b9d35`, scratch plan, **248 placements**. Every timing below is from the exported container
logs (`dataset: containers`), so they are production measurements — the first in this change that
S-308 may quote.

| Measurement | Value |
| ----------- | ----- |
| **Cold start** — `startAndWaitForPorts` → `202 Accepted` | **~5.5 s** |
| ...of which process boot → uvicorn listening | 0.40 s |
| ...process boot → 202 accepted | 0.70 s |
| **Solve** — `solving with 4 workers` → `succeeded` | **14.72 min** |
| **Sleep** — last request → `Shutting down` | **30.002 min** |
| Placement colo | `TXL` (Berlin) — `EEUR` pinning honoured |

**`CONTAINER_START_TIMEOUT_MS = 45_000` is correct and generous.** A 5.5 s cold start on a 394 MB
image leaves an 8× margin. Left unchanged; the constant is now evidence-backed rather than a guess,
and the "measure on the deployed container" comment in `solver-binding-transport.ts` is discharged.

**Two things I asserted during the smoke and had to withdraw**, both corrected by this export:

1. *"The 2–6 s was a warm start, the deploy left an instance running."* **Wrong.** There are no
   container logs at all between the 07:09:34 rollout and `Started server process [1]` at 07:14:07 —
   the deploy provisioned an instance record without starting the process. This was a genuine cold
   start. `wrangler containers instances` reporting `STATE: running` for a provisioned-but-not-
   executing instance is what misled me; that field is not a statement about the process.
2. *"Every deploy starts a ~30-minute billing window."* **Also wrong**, for the same reason —
   nothing ran until the first dispatch.

**The sleep hazard is now measured, not reasoned.** Shutdown began 30.002 minutes after the **last
HTTP request** (the 07:14:08 dispatch), *not* 30 minutes after the solve ended at 07:28:51. Dispatch
is 202-and-detach, so a 14.7-minute solve renews nothing: the effective budget is **30 minutes from
dispatch**, and the PRD's 20-minute ceiling sits inside it with ~10 minutes of headroom. A solve that
overran would be killed — and the shutdown sequence (`Shutting down` → `Application shutdown
complete.` → `Finished server process [1]`, all inside 100 ms) confirms uvicorn does not wait for the
daemon thread that does the solving. This is precisely S-304's scope, and it now has a number.

**4 workers cost far less than feared.** 14.72 min against F-302's ~12.5 min at 8 workers on an M4 —
about **18% slower**, not the 3–5× the local-hardware multiplier suggested. The portfolio-diversity
trade-off recorded when `SOLVER_WORKERS=4` was chosen looks cheap on this evidence. S-308 still owns
the real calibration; this is one data point on one catalog, not a budget.

**Cost, recomputed from observed behaviour.** One solve holds the container ~30 min of provisioned
time plus ~14.7 min of 4-vCPU activity ≈ $0.13. At 5 solves/day that is **~$18/month** before free
tiers, ~$15 after — consistent with the restated PRD figure, and firmly not the original ≈$7.

**One cosmetic finding.** `GET / HTTP/1.1 404` appears at 07:14:08.287: the Container class's
port-readiness probe hits `/`, which the service does not serve. Harmless — a 404 still proves the
port is listening — but `Container.pingEndpoint` could be set to `/health` to make the log honest.
Not changed here; noted as a follow-up.

### 2026-08-18 — Follow-ups filed out of S-302.

- **`solver-mise-scripts-extract`** (filed 2026-08-18 after the impl review) — extract the 300+ lines of
  inline sh in `mise.toml` into `scripts/solver/*.sh` + a shared `lib.sh`, shellcheck-gated; no behaviour change.

- **S-304 (lifecycle)** — inherits `sleepAfter: 30m` and `rollout_active_grace_period: 1200`, both
  stopgaps. The measured facts it needs: the sleep clock runs from the last *request*, and uvicorn's
  graceful shutdown does not wait for the solve thread.
- **S-308 (calibration)** — first production data point: 14.72 min / 248 placements at 4 workers on
  `standard-4`, colo TXL. Also inherits the question of whether 4 remains right.
- **S-306 (E2E)** — Generate still has no browser coverage; S-302 did not close it.
- **Not scheduled, recorded as gaps**: no image vulnerability scanner (base pinned by tag, not
  digest); no egress restriction (`enableInternet` defaults true, `allowedHosts` unset);
  `pingEndpoint` left at `/`; and the Worker-side hole where a *missing* `SOLVER_MACHINE_PASSWORD`
  lets the container boot unconfigured and wedge jobs silently — fixable by refusing to build a
  binding transport when the secret is absent.
- **Closed, not deferred**: GHA Docker layer caching is not warranted (+37 s on a 9-minute pipeline).

### 2026-08-18 — First container deploy: +37 s. GHA layer caching is NOT warranted.

The measurement the no-path-filtering decision promised to take. Run 32109444802, deploy job
07:07:56 → 07:09:37 = **101 s**, against a **64 s** baseline (the last three successful `main`
deploys were 64/63/65 s). **Delta: +37 s.**

| Segment | Time |
| ------- | ---- |
| `wrangler deploy` step | 41 s |
| ...image build | ~7.3 s |
| ...image push (11 layers, `Image does not exist remotely`) | ~17.3 s |
| ...container application rollout (`NEW`) | ~5 s |
| `docker version` / `buildx version` sanity step | 3 s |

**Decision: do not add `cache-from`/`cache-to: type=gha`.** +37 s sits on a pipeline whose critical
path is the 426 s `e2e` job, and the deploy job only starts after all four test jobs finish — so the
end-to-end effect on "merge to live" is 37 s on ~9 minutes. The accepted cost of no path filtering
turns out to be almost nothing, which retires research risk 12 (rated **H/M**) rather than
mitigating it. Re-measure if the image grows substantially; the build is only 7 s today because
`uv sync` resolves from a committed lockfile with every wheel prebuilt.

**Verified live** (`wrangler containers list` + the deploy's own config echo): `standard-4`, `EEUR`,
`max_instances: 1`, `scheduling_policy: default`, observability logs enabled, image
`registry.cloudflare.com/…/ib-timetable-planner-solvercontainer:ac77c484` (digest
`sha256:587a7a38…`). Worker version `ac77c484-0c0f-4879-8ce1-c3d68a0d8fd4`, startup time 25 ms,
upload 3844.42 KiB. Cloudflare added `constraints.tiers: [1, 2]` of its own accord — not in our
config, and not something S-302 set.

**Cost note worth watching.** `containers list` reports **1 live instance immediately after the
rollout**, before any solve was dispatched. Combined with `sleepAfter: 30m`, that means the deploy
itself starts a ~30-minute billing window for memory and disk. Every merge to `main` that changes
the image therefore has a small standing cost beyond the solve itself — a second reason S-304's
lifecycle work matters, and a number S-308 should fold into its calibration budget.

**The registry push had no 403**, so `Containers: Edit` on the existing token was sufficient and the
`Cloudchamber: Edit` fallback stays untested.

### 2026-08-18 — PR #115 was REBASE-merged, not squash-merged. Progress SHAs remapped.

CLAUDE.md's convention is "PRs squash-merge onto `main` with a `(#NN)` suffix". #115 landed as a
**rebase** instead: all seven commits kept their own identity on `main`, without the `(#NN)` suffix,
and every SHA was rewritten.

**Consequence, and why it needed fixing rather than noting.** Each of the 31 SHA suffixes in the
plan's Progress section pointed at a branch commit that is unreachable from `main` — `git show` on
any of them would have failed for anyone reading this change later, and the whole point of the
suffixes is that a Progress row leads to its diff. Remapped one-to-one by matching the `(pN)` suffix
in each commit subject, and each replacement was verified with `git merge-base --is-ancestor`:

| Phase | branch | main |
| ----- | ------ | ---- |
| p1 | `0dbf6f2` | `e004417` |
| p2 | `f6097bb` | `cf6e592` |
| p3 | `ad10ad6` | `dc7e77f` |
| p4 | `0d2b562` | `1a91af6` |
| p5 | `4ed07c3` | `9d184e0` |
| p6 | `a801171` | `aba4ce0` |

**Not a complaint about the merge choice.** A rebase is arguably the better outcome for a
seven-phase change — the per-phase history survives, and that is exactly what makes the remap a
clean one-to-one rather than "all rows now point at one squashed commit". But it does mean the
convention and the practice disagree, and a future change should expect either shape: any tooling
that reads these suffixes must tolerate SHAs being rewritten between the phase commit and the merge.

### 2026-08-17 — Phase 6 closed: hosted enablement done, and the campaign is the credential proof.

All six runbook boxes ticked and dated. The load-bearing outcome is step 6: `mise run solver:hosted`
completed a job on a **scratch plan against hosted**, which proves the whole hosted credential chain
in one shot — the dashboard hook actually firing, the machine user's password, the narrow role
surviving into PostgREST, and the claim/finish writes landing under `solver_job_writer`'s
column-scoped grant. That is more than the checklist's individual steps prove separately.

Also closes the plan's deferred **3.5** (the hosted run Phase 3 could not do before enablement).

**What it does NOT prove, and Phase 7 must.** The campaign authenticates from
`.envs/prod-solver.vars`, not from the Worker secret. So `SOLVER_MACHINE_PASSWORD` on the Worker is
still unverified — the two could have diverged by a typo, and nothing would surface it until a
container tries to sign in. First proof is the production smoke; the symptom would be the container
exiting at startup with `invalid_credentials`, and the fix is `wrangler secret put` again plus a
redeploy. Worth reading the container's first log lines deliberately rather than only checking that
the job row moved.

### 2026-08-17 — Phase 6: the CF token already carried `Containers: Edit`. Risk 5 did not materialise.

**No token change was made** — neither a permission added nor a replacement minted. The deploy token
behind `CLOUDFLARE_API_TOKEN` was inspected in the dashboard and already holds `Containers: Edit`
alongside `Workers Scripts: Edit`, so the narrow-token posture is unchanged by this slice and the
`gh secret set` rotation path was never used.

Worth keeping, because it corrects two artefacts. Research risk 5 rated this **likelihood H** with
impact L, and the reasoning behind that — Cloudflare's `Edit Cloudflare Workers` template does not
include Containers — is still correct as a general warning; it simply did not apply to *this* token,
which was evidently not minted from that template. The conclusion the research reached
(`Workers Scripts: Edit` + `Containers: Edit`, both account-scoped) is confirmed as the requirement.
`Cloudchamber: Edit` remains the untested fallback if a container push ever 403s.

Hosted enablement steps 1–4 completed the same day: the dashboard hook toggle (Postgres hook type,
`public` / `custom_access_token_hook` — **not** the HTTPS variant), the hosted machine user, a
decoded token reading `role: solver_job_writer`, and `SOLVER_MACHINE_PASSWORD` on the Worker.

### 2026-08-17 — Phase 5: doc truth-up applied, following the precedent's one rule.

**Normative docs corrected, dated artifacts annotated** — the rule
`docs(clean-up-bench-generation): truth-up …` established. Every row of `research.md`
§ "Stale claims found" now has an edit:

| Claim | Where | What landed |
| ----- | ----- | ----------- |
| containers#162 a live hazard | `CLAUDE.md`, `prd.md` FR-311, `roadmap.md` S-304 | Re-grounded on "Cloudflare does not guarantee that any container instance will run for any set period of time". All three mentions now read explicitly as closed-2026-05-12 history. **S-304 not deleted** — the wedged-row problem is ours. |
| "path-filtered" | `prd.md` FR-315 + Deploy posture + the migration summary, `roadmap.md` S-302 + table | Removed, with the measurement recorded as a deviation note rather than a silent edit. |
| container secrets in container config | `prd.md` Deploy posture, `docs/runbooks/solver-credential.md` | Restated as the Worker-secrets→`envVars` mechanism; the *intent* (no new Worker privilege) preserved as a property. |
| ≈$7/month | `prd.md` ×2, `tech-stack.md`, `shape-notes.md` | ~$15/month, with the arithmetic explained (the original was right; its 5-minute input was overtaken). |
| `python:3.12-slim` | `tech-stack.md`, `shape-notes.md` | 3.13. |
| solver at `poc/cp-sat`, "promoting" | `tech-stack.md` | Promoted in F-302. |
| solver tests "run nowhere in CI" | `health-check.md`, `stack-assessment.md` | Annotated as closed (dated audits — the conclusions stay, the status is marked). |
| mise graduation is S-302's | `roadmap.md:77` | Attributed to F-302. |
| tier 3 = `wrangler dev` | `roadmap.md` S-302, `prd.md` FR-316 | **Kept — it was right.** See below. |
| `bench` as CI template | `post-poc…/research.md` | Already covered by `clean-up-bench-generation`'s dated banner; nothing owed here. |

**One "stale claim" turned out not to be stale.** Research recorded that the roadmap's tier-3 wording
(`wrangler dev` with the real container binding) named the wrong mechanism, on the grounds that this
project's workerd path runs through `@cloudflare/vite-plugin`. Verified 2026-08-17: `wrangler dev`
honours `.wrangler/deploy/config.json`, picks up the generated `dist/server/wrangler.json` with its
container block, and takes a hidden `--enable-containers` flag. **The original wording was accurate**
and has been confirmed rather than softened — a reminder that a research finding is itself a claim
with a date on it.

**Two additions the docs now carry that the plan did not list**, both learned during implementation:
`README` § Known gaps (no image vulnerability scanner, no egress `allowedHosts`, no E2E for
Generate), and the silent-failure warning attached to the `SOLVER_MACHINE_PASSWORD` Worker secret.

### 2026-08-17 — Phase 3: tier 3 ships on the PRIMARY mechanism; no fallback was needed.

The plan required verifying, before shipping the task, that a redirected `wrangler dev` actually
reaches the container — with a documented manual `dev.enable_containers` flip as the fallback.
**Verified working, so the primary mechanism ships and the fallback is not in the repo.**

Run against `dist/server/wrangler.json` via `.wrangler/deploy/config.json`:

```
⎔ Preparing container image(s)...
#15 naming to docker.io/cloudflare-dev/solvercontainer:8918a2c3 done
    (digest sha256:a89e3f5f… — the SAME image `mise run solver:image:build` produces)
docker.io/cloudflare/proxy-everything@sha256:0ef6716c… pulled
⎔ Container image(s) ready
[wrangler:info] Ready on http://localhost:8790
```

So all three paths that build this image — `solver:image:build`, `wrangler deploy`, and
`wrangler dev --enable-containers` — produce byte-identical output. `--enable-containers` is a
**hidden** boolean flag on `wrangler dev` ("Whether to build and enable containers during
development"); it overrides the committed `dev.enable_containers: false` per session, so no edit to
`wrangler.jsonc` is required and none should be made.

**F5's ordering hazard confirmed empirically, not just reasoned about.** Stripping `SOLVER_URL` from
`.dev.vars` *before* `pnpm build` leaves `dist/server/.dev.vars` with zero `SOLVER_URL` lines;
writing it after the build would leave the URL transport silently in charge and the task would prove
nothing while appearing to pass. `solver:tier3` sequences strip → build → dev → restore, in that
order, with the reason in the source.

One incidental: `wrangler dev` defaults to `:8787` and `astro preview` leaves a workerd on `:8788`,
so the task takes `TIER3_PORT` rather than hardcoding.

### 2026-08-17 — Phase 3 found a real gap the plan did not anticipate: the container's Supabase URL.

`SolverContainer` forwards `env.SUPABASE_URL` into `envVars`. Under local `wrangler dev` that value
comes from `.dev.vars` and reads `http://127.0.0.1:54321` — which **inside the container is the
container**. Proved rather than assumed: running the image with that URL gives
`httpx.ConnectError: [Errno 111] Connection refused`, the fail-closed startup check kills the
process, and `startAndWaitForPorts` would then time out 45 s later. **Tier 3 could never have
completed a job**, and the plan's success criterion 3.4 asks for exactly that.

The Worker and the container genuinely need different values here — the Worker runs on the host and
must use `127.0.0.1` — so one variable cannot serve both. Fix: an optional `SOLVER_SUPABASE_URL`
that `SolverContainer` prefers when present. `solver:tier3` derives it from the existing
`SUPABASE_URL` by swapping `127.0.0.1`/`localhost` for `host.docker.internal`, and skips it entirely
when the URL is already remote. Production sets no such Worker secret, so it is inert there.

Verified: with the rewritten value the container reaches GoTrue and gets a genuine
`400 invalid_credentials` (a wrong password on purpose) instead of `ConnectError` — i.e. it
connected.

**Taken as an opportunity to make the forwarding rule testable.** The env construction moved out of
the DO class into a pure `src/solver-container-env.ts`, with seven tests pinning what the plan had
only asserted in prose: `SOLVER_WORKERS` is explicitly `4` and not the service's default `8`, the
override precedence, empty strings rather than `undefined` (a literal `"undefined"` would make
`settings.configured` read as PRESENT and defeat the bare-container promise), and — the security
one — that **exactly six keys** are forwarded and no more.

Interaction worth recording: Phase 1's fail-closed startup check turned this from a
silent-and-confusing failure (container up, job stuck at `queued`) into a loud one at container
start. It made the bug findable.

**Then the same class of gap bit a second time, on `SOLVER_MACHINE_PASSWORD`** — and this one was
quiet, because it lands in the state the design deliberately tolerates. `wrangler dev` builds the
Worker's `env` from `.dev.vars`, **not from the invoking shell**, so exporting the password had no
effect: `SolverContainer` forwarded `""`, the container saw `credential_configured=False`, and the
startup check *skipped itself* — exactly as `settings.py` promises for a bare container. It then
bound `:8000`, answered 202, and failed at claim. Row stuck at `queued`, orphan clone, no error
anywhere the UI could show. `solver:tier3` now requires the password in the shell and injects it
into `.dev.vars` before the build; the trap's `pnpm env:local` drops it again.

**The residual, stated plainly.** The fail-closed check is fail-closed against a *wrong* role, not
against an *absent* credential — an unconfigured container still boots and wedges every job it takes.
That is the plan's deliberate trade (`/health` must answer on a bare container before secrets are
wired), and it is not being changed here. It does mean **a production Worker missing the
`SOLVER_MACHINE_PASSWORD` secret would wedge every generation silently**. Phase 6 step 4
(`wrangler secret put`) is what prevents it and Phase 7's smoke is what would catch it; both should
be read as load-bearing rather than administrative. If it recurs, the fix is Worker-side — refuse to
build a binding transport when the secret is absent — not a change to the container's boot contract.

### 2026-08-17 — For whoever runs Phase 7's smoke: a succeeded job does NOT mean a filled board.

Observed during tier 3 and briefly mistaken for a container fault, so it is written down here.
Delivery is lazy and **triggered by visiting the SOURCE plan**, not by the solve finishing:
`src/pages/plans/[id]/index.astro` runs `checkGeneration` in the page render, and that call is what
runs the oracle, translates ids and applies placements. `use-generation-job.ts` says so in its
docblock and names S-303 as the owner of polling — "nothing here loops".

Consequence when smoke-testing: after `status=succeeded`, the proposal plan's board is **empty**, and
refreshing the *proposal* page will never fix it — that page's `checkGeneration` is scoped to its own
plan id, which has no job. Go back to the source plan; the visit itself delivers. Identical on tier 1
and in production, and unrelated to the transport.

### 2026-08-17 — Phase 3: `.envs/` is gitignored, so the README is the durable home for profile guidance.

`.envs/prod.vars`'s inaccurate comment (the one claiming a `SOLVER_URL` there "would give prod a
dispatch surface") was restated on this machine — but that file is per-machine and uncommitted, so
the correction cannot travel. The committed version of the argument now lives in README
§ Environment Profiles → "Why `prod.vars` has no `SOLVER_URL`", along with the full
`prod-solver.vars` template. Anyone setting up a new machine reads the README, not another
developer's `.envs/`.

`.envs/prod-solver.vars` currently points at the **local** stack — the rehearsal configuration for
step 3.5. It must be repointed at hosted after Phase 6.

### 2026-08-17 — Unplanned but earned: `solver:dev` now fails fast on a missing credential.

Found by hitting it during Phase 2's manual check. `mise run solver:dev` with no Supabase env booted
looking healthy, took a real dispatch, answered 202 — and only then discovered it could not claim.
Because **dispatch succeeded**, nothing compensates: `startGeneration` cleans up only when dispatch
fails, so the row sat `queued` forever with an orphan proposal clone beside it, and
one-active-job-per-plan blocked that plan's Generate until both were deleted by hand.

The guard is at the **task** level, not in `settings.py`, and that placement is the whole decision.
The service must still boot bare — `/health` answering on an unconfigured container is what a
platform probe hits before secrets are wired, and Phase 1's startup check explicitly skips itself in
that state. What is right for a container is a trap on a developer's machine, so the launcher is
where the asymmetry belongs. `solver:image:smoke` already carried the same guard; `solver:dev` was
simply the one that had never been made to match.

Verified both ways: nothing set → named failure before uvicorn; trio set with a wrong password →
past the guard, into uvicorn, refused by the Phase 1 startup credential check.

### 2026-08-17 — Phase 2: what the installed `@cloudflare/containers@0.3.7` actually confirmed.

Re-verified against the installed package rather than the planning-time Context7 read, as the plan
required. `startAndWaitForPorts({ ports, cancellationOptions: { portReadyTimeoutMS } })` and
`containerFetch(url, init, port)` both exist as planned; `getContainer(ns, name)` returns the stub.
Three details the source settled that docs would not have:

- `containerFetch` builds `new Request(url, init)`, so the URL must be **absolute** — hence
  `http://solver-container/...`. A path alone would throw.
- `startAndWaitForPorts` **throws** on failure, while `containerFetch`'s own implicit start returns a
  503/429/500 **Response**. Calling start explicitly first is what keeps "did not come up" and
  "refused the job" distinguishable — plan review F3's concern, resolved in favour of the RPC pair.
- The `withTimeout` design was kept: an `AbortSignal` still cannot cross Workers RPC, and there is a
  regression test asserting no `signal` ever appears in the RPC arguments.

**`rollout_active_grace_period`, read from current docs (not memory), does NOT protect an in-flight
solve.** It is the minimum wait before an *active* instance becomes eligible for replacement, after
which the instance gets SIGTERM and 15 minutes before SIGKILL. Two reasons it does not help us:
dispatch is 202-and-detach so nothing is in flight to make the instance "active", and uvicorn's
graceful shutdown does not wait for the daemon thread doing the solve. Per plan review F4 the field
ships **explicit anyway** (1200 s = the PRD's 20-minute ceiling) with an accurate comment, and F4's
Fix B fallback is now the real guard: README § Deployment must carry "do not merge to `main` while a
production solve is running". S-304 owns the mechanism.

**Typing: the hand-written ambient file was enough, and it is load-bearing.** `src/cloudflare-env.d.ts`
gives `pnpm check` 0 errors / 0 warnings over 752 files with `@cloudflare/containers` imported, and
no `@cloudflare/workers-types` devDependency was needed. Probed rather than assumed — a scratch file
confirmed that `envVars` rejects a non-string value, an unknown `env.*` binding errors, and
`defaultPort` is a `number`, so the declarations constrain rather than collapsing to `any`.

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
