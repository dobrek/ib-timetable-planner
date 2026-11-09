# Hosted check (S-409 Phase 1)

> Items 1–3 recorded; item 4 (throwaway function) deliberately skipped. Project ref `hwmuiymhjgewtymymbmb`. Dashboard observations reported by the developer on 2026-11-09.

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

Still unproven on hosted, and where each gets covered:

- `verify_jwt = false` honoured on hosted, and the env names (`SUPABASE_SECRET_KEYS`, `SUPABASE_PUBLISHABLE_KEYS`, `SUPABASE_JWKS`) present — Phase 6 hosted smoke (the real function is the probe). Phase 2's local stack covers the same behaviour under the CLI's edge runtime.
- `--region` / `x-region` pinning on this plan — not needed for correctness; revisit only if function latency matters.
- Hosted Deno version — the Phase 2 pin follows the plan's Deno 2.1.4 semantics; a mismatch would surface at the first real deploy (Phase 2 deploy step / Phase 6).

## Trigger form for Phase 3

**`encrypted_password` form**: `AFTER UPDATE OF encrypted_password ... WHEN (old distinct from new)` (item 2 is 0).
