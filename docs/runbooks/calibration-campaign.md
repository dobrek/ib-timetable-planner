# Calibration campaign runbook

The production calibration campaign (S-308) measures the solver's per-stage budgets on the deployed
container. It needs twelve counted runs across four cells, a lifecycle drill, and a renewal
observation. `mise run solver:campaign` drives all of it from your laptop. A person is needed only
for one-time setup, the attended drill, and the Cell D choice.

This runbook says what to do on each of the two office days, what each command does, how to recover
when the runner halts, and what to remove afterwards. The design is in
`context/changes/automate-production-calibration-campaign/`. The campaign's own record (the ledger,
the verdict and the numbers) lives in `context/changes/production-calibration-campaign/`.

> **It writes to production.** It clones a real plan with its board, dispatches solves, switches
> the container's tuning through Worker secrets, and deletes what it created at cleanup. Every
> production step is attended at least once before you leave it unattended.

---

## One-time setup

Do this before Day 1. None of it touches the campaign's data.

### 1. A dedicated campaign account

Create an author account on the hosted project for the runner, following
[author-provisioning.md § b](author-provisioning.md), with **Auto Confirm User** on.

- **Do not give it a `machine_role`.** That `app_metadata` key is what turns an account into the
  solver's narrow database role, so this must stay an ordinary author.
- **Use a dedicated account, not your own.** Signing out in a browser ends the session globally, so
  if you shared an account with the runner, signing out on your laptop would sign the runner out
  mid-campaign.

### 2. The operator allowlist

The runner reads the container's state and stops it when idle through `GET`/`POST
/api/solver/container`, which answers only accounts listed in a Worker secret:

```bash
pnpm exec wrangler secret put SOLVER_OPS_ALLOWED_EMAILS   # the campaign account's email
```

Setting a secret deploys a new Worker version without rolling the container. Do it while nothing is
solving anyway.

### 3. A Cloudflare API token for the logs

The drill, the renewal observation and `verify-startup` read the container's logs through the
Workers Observability Telemetry API. **The `wrangler` login cannot read those logs**: it is refused
with `10000 Authentication error`. Create a custom token:

1. dash.cloudflare.com → profile icon → **My Profile → API Tokens → Create Token → Create Custom Token**.
2. Permission: **Account · Workers Observability · Edit**. A query only reads, but Cloudflare files
   the query endpoint under the Write permission.
3. Account Resources: **Include → your account**.
4. TTL: an end date shortly after the campaign.
5. Copy the token. Cloudflare shows it only once.

### 4. `.envs/campaign.vars`

This file is gitignored and per-machine. The launcher reads it with `sed` and never sources it, so
write bare `KEY=value` lines with no quotes and no `#` inside a value.

```
CAMPAIGN_TARGET=production
CAMPAIGN_BASE_URL=https://ib-timetable-planner.dobromir-kropielnicki.workers.dev
CAMPAIGN_EMAIL=<the campaign account>
CAMPAIGN_PASSWORD=<its password>
CAMPAIGN_SOURCE_PLAN_ID=<the real plan to clone, with its board>
CAMPAIGN_NAME=<a short label; the plan becomes "Calibration — <label>">
ANALYZER_SUPABASE_URL=https://hwmuiymhjgewtymymbmb.supabase.co
ANALYZER_SERVICE_ROLE_KEY=<hosted service-role key>
CLOUDFLARE_OBSERVABILITY_TOKEN=<the token from step 3>
CLOUDFLARE_ACCOUNT_ID=<your account id>
```

- Use the `workers.dev` URL. The custom domain's WAF and bot settings are invisible from the repo.
- **The service-role key goes here and nowhere else.** The runner passes it only to its
  `pnpm analyze:jobs` subprocess, which reads and never writes. Never put it in `.env.test.local`:
  that file feeds `pnpm test:integration`, whose factories **write**.
- Nothing in `pnpm env:*` copies this file.

### 5. Check it

```bash
mise run solver:campaign -- status           # the full grid as pending, with a time estimate
mise run solver:campaign -- verify-startup   # the container's most recent cold start, if within 7 days
```

`status` reads only the journal under `.campaign/`, which is gitignored.

### Rehearse first

The same file with `CAMPAIGN_TARGET=local` runs every path against the local stack. It uses short
stages and a native solver that the runner starts and stops itself, and nothing hosted is touched.
The local profile also needs the local values below, plus `pnpm build && pnpm preview` running
against the local profile:

```
CAMPAIGN_BASE_URL=http://localhost:4321
CAMPAIGN_EMAIL=e2e-author@example.test
CAMPAIGN_PASSWORD=e2e-author-password
ANALYZER_SUPABASE_URL=http://127.0.0.1:54321
ANALYZER_SERVICE_ROLE_KEY=<local service-role key from .env.test.local>
LOCAL_SOLVER_SUPABASE_URL=http://127.0.0.1:54321
LOCAL_SOLVER_SUPABASE_KEY=<local publishable key>
LOCAL_SOLVER_MACHINE_PASSWORD=<the local solver machine user's password>
```

A journal is bound to the target it was set up with. To switch, move `.campaign/` aside.

---

## The merge freeze

**Do not merge to `main` while the campaign runs.** Every merge deploys, and every deploy rolls the
container, killing the solve in flight. That includes Worker-only diffs, because the image build is
not byte-reproducible. The drill is the one deliberate exception, and it deploys from your laptop.

---

## Day 1 — setup, the drill, the renewal proof, Cells A and B

Budget about 3 h of runner time and about 45 min attended.

1. **Setup** (attended, minutes):

   ```bash
   mise run solver:campaign -- setup
   ```

   This clones the source plan **with its board** and prints the hours left to place. It refuses
   when there are none, because every Generate would then fail. The campaign measures a
   fill-the-gaps solve, so its numbers are not comparable with S-302's full-catalog run.

2. **The drill** (attended, about 45 min; Docker running, tree clean at `origin/main`, image pre-built):

   ```bash
   mise run solver:image:build
   mise run solver:campaign -- drill
   ```

   It applies the 240 s cell, dispatches, waits for a checkpoint at position 3 or later, then commits
   an image-changing marker and runs `wrangler deploy` **from your laptop**. Then it checks four
   things:
   - the row ends `interrupted` with its checkpoint
   - the shutdown pair appears in the logs
   - the proposal delivers
   - its page shows "kept the board from stage N"

   It then dispatches again: that self-heal is **Cell C run 1**. While that run solves, it switches
   the secret to Cell A and records whether the solve survives the change. At the end it prints the
   push command for the marker commit. Push only once nothing is solving.

3. **Push the drill commit, then ship `sleepAfter = "10m"`.** The marker commit is deployed but exists
   only on your laptop. Push it first, while nothing is solving, so `main` matches what is live. Then
   merge S-308 Phase 3's `sleepAfter` change, also while idle, and watch the Deploy job finish green.
   Both deploys roll the container, and that is fine while it is idle.

4. **The renewal proof** (unattended, about 30 min):

   ```bash
   mise run solver:campaign -- renewal
   ```

   It refuses unless the deployed class reports `sleepAfter = "10m"`. It runs **Cell A run 1**, then
   reads only the logs until the idle container stops. It must not touch the Worker during that
   wait, because a control-route call would push the stop out by a full `sleepAfter`. It prints the
   five production numbers and the observed `unaccounted` values as a dated block: paste it into
   S-308's `change.md`.

5. **Cells A and B** (unattended):

   ```bash
   mise run solver:campaign -- run
   ```

   Leave it running. It survives a closed lid, because the journal resumes it. If you need to stop
   it, press Ctrl-C once. It finishes the step in hand, parks the override when nothing is solving,
   and exits. Run it again to continue.

## Day 2 — Cell C, the Cell D choice, Cell D

1. `mise run solver:campaign -- run` finishes C. Run 1 came from the drill. The runner then parks
   and **pauses**, printing the cross-cell matrix.
2. **Choose Cell D** from the matrix. That is a judgement, and no rule makes it. Then:

   ```bash
   mise run solver:campaign -- set-cell D <workers> <stageS> <modeAS>
   mise run solver:campaign -- run
   ```

   `set-cell` refuses values the Worker would ignore: workers outside 1–16, a stage outside
   1–1800 s, or Mode A outside 1–3600 s.

3. When D is done the runner parks and reports the grid complete. S-308 Phase 5 then ships the
   chosen constants. After that, `run-one` measures one solve under the shipped `main`.

---

## Commands

| Command                             | What it does                                                                                       | Touches                    |
| ----------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------- |
| `status`                            | Position, valid and excluded runs per cell, time remaining, the live override and its age          | the journal only           |
| `setup [--adopt <id> \| --abandon]` | Clones the source plan with its board; refuses an empty one. The flags settle an interrupted setup | app                        |
| `run`                               | Steps until a pause, a halt or Ctrl-C                                                              | app, secrets, logs         |
| `set-cell D w s a`                  | Supplies Cell D after the pause                                                                    | the journal only           |
| `run-one`                           | One run under `main`'s constants, after the grid                                                   | app, secrets               |
| `park`                              | Removes the override and verifies it                                                               | secrets                    |
| `resume`                            | Forgives a halt's failures so `run` can go on                                                      | the journal only           |
| `cleanup`                           | The strict cleanup order, after a typed confirmation                                               | app, secrets               |
| `verify-startup`                    | The container's most recent startup line and its values                                            | logs only                  |
| `drill`                             | The attended deploy-during-solve drill                                                             | app, secrets, local deploy |
| `renewal`                           | Cell A run 1, the renewal and idle lines, the five numbers                                         | app, secrets, logs         |

Each run follows the same sequence:

- **Each cell:** no job active on any plan, then `secret bulk`, then `status()` agrees, then
  `stop-if-idle`, then `running: false`.
- **Each run:** no job active on the campaign plan, then dispatch, wait, deliver, record.

A run counts only when its row says it solved under the cell it was dispatched for. The ledger reads
that from `solver_config`, on the container's host. Anything else is recorded as excluded and
retried once after a fresh stop.

---

## When it halts

The runner halts rather than guess. The journal keeps everything, and `status` shows where it
stopped and why.

| It says                                                   | Do                                                                                                                                                                                    |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cell X run N failed twice — …`                           | Read the two reasons, which `status` lists under _excluded runs_. Fix the cause (a deploy landed, the container is unhealthy, the wrong host answered), then run `resume` and `run`.  |
| `the container refused to stop (busy)` / `(unknown)`      | Something is solving, or the probe could not tell. Find out what with `ANALYZE_ACTIVE=1` and `pnpm analyze:jobs` against the hosted project. Once it is idle, run `resume` and `run`. |
| `status() did not reflect the secret change within 180 s` | Check `GET /api/solver/container` in a browser while signed in as the campaign account, then rerun `run`. A secret bulk is idempotent.                                                |
| `job … is already active on the campaign plan`            | Someone dispatched on the campaign plan by hand. Let it finish, then `run`.                                                                                                           |
| `a setup was interrupted …`                               | Look for that exact plan name in the plans list: `setup --adopt <planId>` if it exists, `setup --abandon` if not.                                                                     |
| an error, then `the journal keeps any interrupted step`   | Fix the cause and rerun the same command. A dispatch whose answer was lost is found again, never sent twice.                                                                          |

**A hard stop skips parking.** Examples are a second Ctrl-C, a killed terminal or a flat battery.
`status` then shows the live override and its age. Run `park` once nothing is solving.

---

## Afterwards

1. **The ledger is the record.** Cleanup refuses until it is copied:

   ```bash
   cp .campaign/ledger.json context/changes/production-calibration-campaign/ledger.json   # then commit it
   ```

2. **Cleanup**, in the order the runner enforces:

   ```bash
   mise run solver:campaign -- cleanup
   ```

   It delivers every proposal, deletes each proposal by id, deletes the campaign plan (which
   cascades its job rows), and removes the `CALIBRATION_*` overrides.

3. **Remove what setup added:**

   ```bash
   pnpm exec wrangler secret delete SOLVER_OPS_ALLOWED_EMAILS   # the route then answers 404 to everyone
   ```

   - Delete the observability API token in the dashboard (**My Profile → API Tokens**), unless its
     TTL has already ended.
   - Disable or delete the campaign account.
   - Remove the hosted keys from `.envs/campaign.vars`, or delete the file.
   - `.campaign/` can go too. Only the ledger in S-308's folder is kept.
