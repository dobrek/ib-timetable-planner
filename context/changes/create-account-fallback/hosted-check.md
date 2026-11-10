# Hosted check (S-409 Phase 1)

> Items 1–3 recorded; item 4 (throwaway function) deliberately skipped; the Phase 6 hosted smoke test is § 5. Project ref `hwmuiymhjgewtymymbmb`. Dashboard observations reported by the developer on 2026-11-09.

## 1. Signing key and API keys

- Dashboard, JWT Signing Keys (2026-11-09): **current** key `c269edd0-ddfe-4aec-87d6-0be00f5a0a67`, ECC (P-256) = ES256. **Previously used**: `54683610-df82-43e1-ae1f-b64095b55630`, HS256.
- Public JWKS (`/auth/v1/.well-known/jwks.json`, 2026-11-09): one key, ES256, same `kid`. The HS256 key is symmetric and not published.
- Dashboard, API Keys (2026-11-09): publishable and secret keys exist as expected; the secret key is named `default`.
- Consequence: the function's `withSupabase({ auth: "user" })` verifies against the ES256 JWKS. A still-unexpired token signed with the previous HS256 key would be refused (401) until it expires, so that is a transient sign-in nuisance, not a defect.

## 2. DB encryption (`encrypted_password like '{%'`)

`0` (SQL Editor, 2026-11-09). DB encryption is off.

## 3. Hosted GoTrue version

`v2.197.0` (`/auth/v1/health`, 2026-11-09). Local CI stack runs v2.196.0 — one patch ahead.

## 4. Throwaway function

**Skipped by the developer's decision (2026-11-09).** The Supabase CLI was not logged in and the developer chose to move on. Nothing was deployed to hosted, so there is nothing to delete.

What it would have proven, and where each was covered instead:

- `verify_jwt = false` honoured on hosted, and the env names (`SUPABASE_SECRET_KEYS`, `SUPABASE_PUBLISHABLE_KEYS`, `SUPABASE_JWKS`) present — **proven by the real function (§ 5)**.
- Hosted Deno version — **proven**: the exact pins deployed and the function ran on hosted (§ 5).
- `--region` / `x-region` pinning on this plan — not needed for correctness; revisit only if function latency matters. Still open, by choice.

## Trigger form for Phase 3

**`encrypted_password` form**: `AFTER UPDATE OF encrypted_password ... WHEN (old distinct from new)` (item 2 is 0).

## 5. Hosted smoke test (Phase 6, 2026-11-10)

Run against `8da89dd5`, which main's CI deployed (run 42829528007, every job green). The deploy applied `20261109143000_must_change_password.sql` and deployed `admin-users` with `--use-api`.

- **No token → 401 from `@supabase/server`** (`MISSING_CREDENTIALS`), not from the platform gateway, so `verify_jwt = false` is honoured and the function boots on hosted. Observed by the agent.
- **Create → first sign-in → change → 403 → delete**: the developer ran every step on production and reported each as expected. A viewer account was created on `/users`. Its first sign-in held it on `/account` with `must_change_password` still `true`, so hosted GoTrue does not rewrite the hash on sign-in. Choosing a password cleared the flag and the account reached viewer pages. A viewer token got 403 from the function (a scratch script that asked to re-issue the password of the nil user id). The test account was deleted in the dashboard.
