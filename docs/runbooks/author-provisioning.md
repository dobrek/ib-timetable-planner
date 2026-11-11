# Author provisioning runbook

This app has **no self-service signup by design** (roadmap F-01,
`gated-author-provisioning`). Student names and choices are PII and must not sit
behind a publicly reachable registration form, so the only way to get an account
is to be given one. **The normal path is an invitation**: an admin invites the
person by email from the Users page ([a-0](#a-0-invite-a-colleague-the-normal-path)).
For someone an invitation cannot reach, an admin creates the account with a
temporary password instead. Someone with backend access is needed only for the
first admin, or when no admin can sign in. This runbook covers all of it, locally
and on the hosted project, and how to keep registration closed.

The gate is enforced at two layers:

- **App** — there is no signup page or API route, and the middleware is
  deny-by-default (`src/middleware.ts`): every route requires an authenticated
  session except `/auth/signin`, the password-reset pages `/auth/forgot` and
  `/auth/confirm` (which also accepts invitation links since S-410), the
  `/api/auth/` endpoints, and static assets. A reset or an invitation link only
  ever reaches an account that already exists: an invitation's account is made
  by an admin before its email is sent.
- **Supabase** — `enable_signup = false` under `[auth]` in `supabase/config.toml`
  (local) and the equivalent dashboard toggle (hosted) reject account creation
  even if someone calls the auth REST endpoint directly.

> Note on `supabase/config.toml`: `[auth] enable_signup = false` is the flag that
> blocks new signups. The nested `[auth.email] enable_signup` is deliberately left
> `true` — in the local CLI that key drives `GOTRUE_EXTERNAL_EMAIL_ENABLED`, and
> setting it `false` disables the email provider entirely ("Email logins are
> disabled"), which would break sign-in for existing authors. Do not flip it.

---

## a-0) Invite a colleague (the normal path)

Since S-410 an admin onboards a colleague without anyone touching a dashboard:

1. On the Users page (`/users`), press **Invite**, enter the colleague's email and
   choose a role (Viewer by default; an invitation always grants a role).
2. The colleague gets "You're invited to IB Planner" from the app's sender
   ([`email-delivery.md`](email-delivery.md)). Its one link works once, for
   24 hours, and only the newest email works.
3. The link opens a page that needs a deliberate **Continue**, so a mail scanner
   cannot spend it. Continue signs them in, still without access, on their
   account page, which welcomes them.
4. They choose a password (at least 15 characters) and land on the dashboard with
   the role the admin chose: read-only for a viewer.

The row reads **Invited** until then, **Invitation expired** once the link's
24 hours pass unaccepted, and **Invitation accepted** if they pressed Continue but
have not chosen a password yet. An admin can:

- **Re-send** an unaccepted invitation (expired or not): a new link, and the old
  one dies. Inviting the same address again does the same, with the role chosen
  now. Either is refused within a minute of the last email.
- **Revoke** an invitation until the person chooses a password: the never-used
  account is deleted and its link stops working.

An address that already has an account is refused, and nothing is sent. A
colleague whose link expired can also use **Forgot password?**: the reset proves
the same mailbox, and they still hold no access until they choose a password. So
the 24 hours bound the link, not the invitation; **Revoke** is the stop.

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

For the first admin, or when no admin can sign in. Everyone else is invited
([a-0](#a-0-invite-a-colleague-the-normal-path)).

1. Open the project in the Supabase dashboard (https://supabase.com/dashboard).
2. Go to **Authentication → Users → Add user → Create new user**.
3. Enter the email and a password of **at least 15 characters** (the hosted
   floor — see [`hosted-auth-settings.md`](hosted-auth-settings.md)). Enable
   **Auto Confirm User** so the author can sign in without an email round-trip
   (hosted keeps `mailer_autoconfirm` on; that runbook records what it implies).
4. Give the account a role. An admin does it on the Users page (`/users`). To
   bootstrap the first admin, or when no admin can sign in, use the script from a
   human shell with the hosted URL and **secret** key exported
   ([b-bis](#b-bis-assign-or-change-a-role-script)):

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
the fallback is an admin on the Users page when the account is still on its temporary password
(**Re-issue password**, S-409), and the dashboard (**Authentication → Users**) otherwise, until S-411
adds an admin-side reset.

**An account for someone an email invitation cannot reach** (S-409, FR-403) is made on the Users page
(**Create account**, the fallback beside **Invite**), not in the dashboard: the app generates a 24-character temporary password and
shows it once, and the person must choose their own at first sign-in, until when they hold no access.
The password is not recoverable from the page after it is closed; a lost one is replaced with
**Re-issue password**. It does not expire (see the PRD's accepted residual): a pending row on the Users
page says "Temporary password", which is how an unused one is noticed.

---

## b-bis) Assign or change a role (script)

Every human account holds one role, `admin`, `author` or `viewer`, in
`public.user_roles` (S-403). **The normal path is the Users page** (`/users`,
S-406): an admin gives, changes or removes anyone's role there, and the page shows
who made the last change and when.

`scripts/assign-role.mjs` stays for **bootstrap and recovery**: the first admin of
a fresh stack (after a local `db reset`), or a school whose admins cannot sign in.
It runs with the service-role key:

```bash
node scripts/assign-role.mjs <email> <admin|author|viewer|none>
```

- **`none`** deletes the role row; any other role creates or replaces it. The
  script prints the target host and the role before → after.
- **Machine accounts are refused.** An account with `app_metadata.machine_role`
  (the solver's) must never hold a human role. The database refuses it too.
- **Recorded as the Operator.** Every role write lands in `public.access_changes`.
  A write from the script has no signed-in actor, so the Users page shows it as
  "Changed by Operator".
- **The last admin is guarded.** Demoting the school's only admin, or setting them
  to `none`, is refused ("refused: the school must keep at least one admin"), and
  the role stays as it was. Promote another admin first, then step the first one
  down. The same rule binds the Users page. Deleting an account is not guarded
  here; S-411 owns that.
- **Keys.** The script writes outside any session, so it needs the **secret** key:
  export `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from your shell, never a
  committed file. For the local stack both fall back to `.env.test.local`.
- **A non-local host** needs `ASSIGN_ROLE_CONFIRM=yes`, or the script refuses
  before it changes anything.

S-403's first migration made every human who existed when it ran an `author`.
Since S-406, the first admin is the script's job, and every role after that is
the Users page's.

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
The absence is intentional and load-bearing for data privacy. New users are
invited by an admin ([a-0](#a-0-invite-a-colleague-the-normal-path)) or, as the
fallback, created on the Users page with a temporary password. Steps (a) and (b)
remain for the first admin and for recovery, by someone with backend access, with
the role given through [b-bis](#b-bis-assign-or-change-a-role-script).
