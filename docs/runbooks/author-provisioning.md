# Author provisioning runbook

This app has **no self-service signup by design** (roadmap F-01,
`gated-author-provisioning`). Student names and choices are PII and must not sit
behind a publicly reachable registration form, so the only way to get an account
is for someone with backend access to create it. This runbook covers how to do
that locally and on the hosted project, and how to keep registration closed.

The gate is enforced at two layers:

- **App** — there is no signup page or API route, and the middleware is
  deny-by-default (`src/middleware.ts`): every route requires an authenticated
  session except `/auth/signin`, the password-reset pages `/auth/forgot` and
  `/auth/confirm`, the `/api/auth/` endpoints, and static assets. A reset only
  ever reaches an account that already exists.
- **Supabase** — `enable_signup = false` under `[auth]` in `supabase/config.toml`
  (local) and the equivalent dashboard toggle (hosted) reject account creation
  even if someone calls the auth REST endpoint directly.

> Note on `supabase/config.toml`: `[auth] enable_signup = false` is the flag that
> blocks new signups. The nested `[auth.email] enable_signup` is deliberately left
> `true` — in the local CLI that key drives `GOTRUE_EXTERNAL_EMAIL_ENABLED`, and
> setting it `false` disables the email provider entirely ("Email logins are
> disabled"), which would break sign-in for existing authors. Do not flip it.

---

## a) Create an author locally (Supabase Studio)

The local stack auto-confirms email (`[auth.email] enable_confirmations = false`),
so a user created in Studio can sign in immediately. It holds no role until you
give it one (step 5): from S-403's enforcement on, an account without a role sees
only a "no access yet" notice and its own account page.

1. Start the local stack if it isn't running:

   ```bash
   pnpm exec supabase start
   ```

2. Open Supabase Studio at **http://127.0.0.1:54323**.
3. Go to **Authentication → Users → Add user → Create new user**.
4. Enter the author's email and a password of **at least 15 characters** (the
   Auth floor, `minimum_password_length`; a shorter one is refused). Ensure
   **Auto Confirm User** is enabled (or leave the default — local config
   auto-confirms regardless).
5. Give it a role ([b-bis](#b-bis-assign-or-change-a-role-script)):

   ```bash
   node scripts/assign-role.mjs <email> author
   ```

6. Sign in at **http://localhost:4321/auth/signin** with those credentials.

A `db reset` deletes every local user and role, so repeat steps 2–5 after one.

If you changed `enable_signup` in `config.toml`, the local stack must be
restarted for it to take effect:

```bash
pnpm exec supabase stop && pnpm exec supabase start
# or: pnpm exec supabase db reset
```

---

## a-bis) Provision the e2e author programmatically (script)

The e2e suite (`pnpm test:e2e`) needs a sign-in-ready author. Instead of clicking
through Studio, `scripts/provision-e2e-author.mjs` creates it via the admin API
(`auth.admin.createUser`), which bypasses `enable_signup = false`, and gives it
the `author` role. It runs automatically as the **`pretest:e2e` hook** before
every e2e run (locally and in CI) and is **idempotent** — a re-run against an
existing author succeeds rather than erroring, and re-asserts the role, so it is
safe to run repeatedly. The author is created after the migrations ran, so the
S-403 backfill never sees it: the role comes from this script alone.

It is **loopback-only**: the author's password is a public literal, so the script
refuses any non-local `SUPABASE_URL` before it sends a request.

**What it reads:**

- `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` from the environment. Locally, if
  they aren't exported it falls back to parsing `.env.test.local` (the same file
  the integration lane's `load-test-env.ts` reads); in CI the `e2e` job exports
  them from its ephemeral stack via `supabase status`.
- The author credentials from the shared `e2e/author-credentials.mjs` module:
  `E2E_AUTHOR_EMAIL` / `E2E_AUTHOR_PASSWORD` if set, otherwise the **fixed local
  default** (`e2e-author@example.test`). The setup spec (`e2e/auth.setup.ts`)
  imports the **same** module, so the provisioned account always matches the one
  sign-in resolves. The local stack is ephemeral, so the fixed default is
  low-risk and there is no CI secret to rotate.

Run it directly if you want the author without running the suite:

```bash
node scripts/provision-e2e-author.mjs
```

It exits non-zero with a clear stderr message if `SUPABASE_URL` /
`SUPABASE_SERVICE_ROLE_KEY` are absent. Local `enable_confirmations = false`
makes the created user immediately sign-in-ready.

---

## b) Create an author on the hosted project (Supabase dashboard)

1. Open the project in the Supabase dashboard (https://supabase.com/dashboard).
2. Go to **Authentication → Users → Add user → Create new user**.
3. Enter the email and a password of **at least 15 characters** (the hosted
   floor — see [`hosted-auth-settings.md`](hosted-auth-settings.md)). Enable
   **Auto Confirm User** so the author can sign in without an email round-trip
   (hosted keeps `mailer_autoconfirm` on; that runbook records what it implies).
4. Give the account a role from a human shell, with the hosted URL and **secret**
   key exported ([b-bis](#b-bis-assign-or-change-a-role-script)):

   ```bash
   ASSIGN_ROLE_CONFIRM=yes node scripts/assign-role.mjs <email> author
   ```

5. Hand the credentials to the author over a secure channel; have them sign in at
   the deployed `/auth/signin`, open **Account** from the sidebar footer
   (`/account`), and change the password there. It takes no current password, and
   it signs their other devices out.

**A forgotten password** needs nobody with backend access since S-402: the author
uses **Forgot password?** on the sign-in page (`/auth/forgot`) and gets a link by
email ([`email-delivery.md`](email-delivery.md)). If the email cannot reach them,
the fallback is the dashboard (**Authentication → Users**) until S-409.

---

## b-bis) Assign or change a role (script)

Every human account holds one role, `admin`, `author` or `viewer`, in
`public.user_roles` (S-403). Until S-406 ships a Users page, the only way to set
one is `scripts/assign-role.mjs`, run by someone with the service-role key:

```bash
node scripts/assign-role.mjs <email> <admin|author|viewer|none>
```

- **`none`** deletes the role row; any other role creates or replaces it. The
  script prints the target host and the role before → after.
- **Machine accounts are refused.** An account with `app_metadata.machine_role`
  (the solver's) must never hold a human role.
- **Keys.** Nobody writes a role through the Data API, so the script needs the
  **secret** key: export `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from your
  shell, never a committed file. For the local stack both fall back to
  `.env.test.local`.
- **A non-local host** needs `ASSIGN_ROLE_CONFIRM=yes`, or the script refuses
  before it changes anything.

S-403's first migration made every human who existed when it ran an `author`.
The developer's `admin`, and the role of every account created since, are this
script's job.

---

## c) Close registration on the hosted project

The `enable_signup = false` line in `supabase/config.toml` governs the **local**
stack only. The hosted project has its own toggle that must be closed separately.

**Via the dashboard:**

1. **Authentication → Sign In / Providers** (or **Auth → Providers → Email**).
2. Disable **Allow new users to sign up** (the hosted equivalent of
   `[auth] enable_signup = false`).
3. Keep the **Email** provider itself **enabled** — disabling it would block
   sign-in, not just signup.

Never via `supabase config push`: it sends the whole local `config.toml`, a
development config that would point hosted's Site URL at localhost and drop the
reset flood guard (see [`solver-credential.md`](solver-credential.md#do-not-reach-for-supabase-config-push-unless-you-have-read-this)).

Verify it read-only — `disable_signup` must be `true` (the command is in
[`hosted-auth-settings.md`](hosted-auth-settings.md#check-them-read-only)). Do not
probe with a real sign-up request: if registration were open, the probe would
create an account.

---

## d) There is no in-app signup — by design

Do not re-add a signup page, a signup API route, or a "Sign up" link.
The absence is intentional and load-bearing for data privacy. New authors are
always provisioned through steps (a) or (b) above by someone with backend access,
and given their role through [b-bis](#b-bis-assign-or-change-a-role-script).
