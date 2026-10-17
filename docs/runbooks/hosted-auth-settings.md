# Hosted Auth settings runbook

Three hosted Supabase Auth settings that account self-service (S-401) depends on. None of them can
reach hosted from the repo: `supabase/config.toml` is the **local development** config, and it is
never pushed (`supabase config push` sends the whole file — see
[`solver-credential.md`](solver-credential.md#do-not-reach-for-supabase-config-push-unless-you-have-read-this)).
One of the three has no `config.toml` key at all, so local and CI can never reproduce it. Hosted is
therefore set and checked **by hand**, here.

## The three values

| Management API field                                | Must be | Why                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `password_min_length`                               | `15`    | The PRD's floor (§NFG). It has to live in Auth, because the `@supabase/ssr` cookies are not HttpOnly and a user can call `PUT /auth/v1/user` around the form. The form's Zod rule is UX only. Local is `minimum_password_length = 15` (`config.toml:176`).                                                                                                          |
| `security_update_password_require_reauthentication` | `false` | "Secure password change". When on, a session older than 24 hours must supply a nonce that is **emailed** (`auth.reauthenticate()`), and S-401 sends no email (that is S-402). Every password change would fail. Local is `secure_password_change = false` (`config.toml:215`). The CLI's docs describe this key as "requires the current password", which is wrong. |
| `security_update_password_require_current_password` | `false` | "Require current password when updating". PRD FR-411 dropped the current-password rule: a user arriving from a reset link (S-402) cannot supply it. **No `config.toml` key exists.**                                                                                                                                                                                |

**The accepted trade-off** (FR-411): with no current-password check, anyone holding a live session —
a stolen cookie, an unlocked shared PC — can change the password and lock the owner out. Until
S-402 ships the self-service reset, recovery is the developer setting a new password in the
dashboard (`author-provisioning.md` § b).

In the dashboard all three sit under **Authentication → Sign In / Providers → Email** (labels as of
2026-10; the Management API field names above are the stable reference).

## Check them (read-only)

Needs a personal access token (dashboard → **Account → Access Tokens**). It is read-only here.

```bash
curl -s -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  https://api.supabase.com/v1/projects/hwmuiymhjgewtymymbmb/config/auth \
  | jq '{password_min_length,
         security_update_password_require_reauthentication,
         security_update_password_require_current_password}'
# Expect: 15, false, false
```

The hosted GoTrue version (local runs v2.196.0, the lockfile CLI's default):

```bash
curl -s -H "apikey: <publishable key>" https://hwmuiymhjgewtymymbmb.supabase.co/auth/v1/health
```

## Set the floor

Dashboard (**Minimum password length** → 15), or the Management API by hand:

```bash
curl -s -X PATCH -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H 'Content-Type: application/json' \
  https://api.supabase.com/v1/projects/hwmuiymhjgewtymymbmb/config/auth \
  -d '{"password_min_length": 15}'
```

Never turn either toggle **on**. If one is found on, turn it off and record it below.

## What goes wrong when a value drifts

- **A toggle flipped on.** Every change on `/account` fails with a toast carrying GoTrue's own
  message, and the action answers `INTERNAL_SERVER_ERROR`. The codes are `reauthentication_needed`
  ("Secure password change") and `current_password_required` / `current_password_invalid`
  ("Require current password"). `src/_pages/account/api/unwrap-auth.ts` sends them to its catch-all
  on purpose, so this list is where such a failure gets diagnosed.
- **The floor unset or lowered.** Nothing visibly breaks: the form still refuses a short password.
  But the floor is then UX only, because a direct `PUT /auth/v1/user` gets through.
- **Existing passwords under the floor** are expected, not drift. GoTrue applies the floor when a
  password is _set_, never at sign-in, and reports the shortfall as `weakPassword`: sign-in then
  lands on `/dashboard?notice=weak-password`, whose banner points at `/account`. It shows after every
  such sign-in until the password changes.

## Last verified

| Date       | `password_min_length` | Reauthentication | Current password | GoTrue       | By                                             |
| ---------- | --------------------- | ---------------- | ---------------- | ------------ | ---------------------------------------------- |
| 2026-10-17 | 15 (set)              | `false`          | `false`          | not recorded | the developer, before S-401 Phase 1 (plan 1.9) |
