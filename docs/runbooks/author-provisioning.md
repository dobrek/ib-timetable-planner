# Author provisioning runbook

This app has **no self-service signup by design** (roadmap F-01,
`gated-author-provisioning`). Student names and choices are PII and must not sit
behind a publicly reachable registration form, so the only way to get an account
is for someone with backend access to create it. This runbook covers how to do
that locally and on the hosted project, and how to keep registration closed.

The gate is enforced at two layers:

- **App** — there is no signup page or API route, and the middleware is
  deny-by-default (`src/middleware.ts`): every route requires an authenticated
  session except `/auth/signin`, the `/api/auth/` endpoints, and static assets.
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
so a user created in Studio can sign in immediately.

1. Start the local stack if it isn't running:

   ```bash
   pnpm exec supabase start
   ```

2. Open Supabase Studio at **http://127.0.0.1:54323**.
3. Go to **Authentication → Users → Add user → Create new user**.
4. Enter the author's email and a password. Ensure **Auto Confirm User** is
   enabled (or leave the default — local config auto-confirms regardless).
5. Sign in at **http://localhost:4321/auth/signin** with those credentials.

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
(`auth.admin.createUser`), which bypasses `enable_signup = false`. It runs
automatically as the **`pretest:e2e` hook** before every e2e run (locally and in
CI) and is **idempotent** — a re-run against an existing author succeeds rather
than erroring, so it is safe to run repeatedly.

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
3. Enter the email and password. Enable **Auto Confirm User** so the author can
   sign in without an email round-trip (no SMTP is configured for this project).
4. Hand the credentials to the author over a secure channel; have them sign in at
   the deployed `/auth/signin` and change the password.

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

**Via the CLI** (if you manage hosted config from `config.toml`):

```bash
pnpm exec supabase link --project-ref <project-ref>   # one-time
pnpm exec supabase config push                        # pushes config.toml to hosted
```

Verify by sending a direct signup request to the hosted auth endpoint — it should
be rejected:

```bash
curl -i -X POST 'https://<project-ref>.supabase.co/auth/v1/signup' \
  -H "apikey: <anon-key>" \
  -H 'Content-Type: application/json' \
  -d '{"email":"test@example.com","password":"whatever123"}'
# Expect: 422 / "Signups not allowed for this instance"
```

---

## d) There is no in-app signup — by design

Do not re-add a signup page, a signup API route, or a "Sign up" link.
The absence is intentional and load-bearing for data privacy. New authors are
always provisioned through steps (a) or (b) above by someone with backend access.
