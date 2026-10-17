<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Account Self-Service (S-401)

- **Plan**: context/changes/account-self-service/plan.md
- **Mode**: Deep (extra focus: over-engineering, functional/readability fit)
- **Date**: 2026-10-17
- **Verdict**: REVISE
- **Findings**: 1 critical, 9 warnings, 0 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | WARNING |
| Architectural Fitness | WARNING |
| Blind Spots | FAIL |
| Plan Completeness | WARNING |

## Grounding

20/20 paths ✓, 9/9 symbols ✓ (`AppShellLayout` is the import alias of `SidebarLayout.astro`), brief↔plan ✓, Progress↔Phase ✓ (5/5 phases, 30/30 rows). 1 claim ✗: "the `\u` escapes in the regex" — the plan's regex is literal invisible characters (→ F6).

The core of the plan is solid: GoTrue session mechanics, RLS and grants, `return=minimal`, one island with one Toaster. Nearly every finding is about weight. Taken together, the lean fixes remove roughly 15 file changes without changing what users get.

## Findings

### F1 — The profiles write cells, as specified, fail their own guard

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 1 §7 (role-matrix expectations)
- **Detail**:
  - **The DELETE row has nothing to evidence it.**
    - Adding `profiles` to `RepresentativeTable` forces a `WRITES.profiles.delete` row, because `WRITES` is `Record<…, Record<WriteOperation, Cell>>`. That row is denied for every principal.
    - `OWN_ROW_WRITES` covers only insert and update, so the relaxed guard ("evidenced by its own-row counterpart") has nothing to pair it with.
    - Result: `role-matrix-expectations.test.ts:21-23` goes red, and step 1.4 cannot pass as written.
  - **The own-row cells depend on their order.**
    - A user owns exactly one profile row, so "each write cell acts on a fresh target" (`role-matrix.integration.test.ts:56`) cannot hold.
    - Own-UPDATE passes only if own-INSERT ran first. Run alone, it reaches 0 rows and reads "denied".
    - The plan never says how each cell sets up its own row.
  - **Readability.** `WRITES.profiles.update.noRole = "denied"` reads as "users can't update profiles". The hidden meaning, "the fixture owner's row", lives only in prose.
- **Fix**: Keep `profiles` out of `RepresentativeTable`, `WRITES`, `WRITE_PROBES` and `WriteProbeBuilder`; none of them change. Add one explicit `PROFILE_WRITES: Record<"own" | "others", Record<"insert" | "update", Cell>>`.
  - The guard pairs `others[op]` with `own[op]`.
  - DELETE is already proven by the catalog check: `GRANTS.profiles.authenticated` has no DELETE.
  - Own-INSERT first deletes the principal's row as admin. Own-UPDATE first upserts it as admin.
  - Strength: no change to the shape of 15 existing builders, no overloaded meaning, no order dependence.
  - Tradeoff: a third write record, though it is the one the "whose row" dimension actually needs.
  - Confidence: HIGH — read directly from the matrix code.
  - Blind spot: S-403's `user_roles` may want the same record. Generalize then, not now.
- **Decision**: PENDING

### F2 — Auth error mapper: 7 rows, ~3 reachable, shared at first use

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Lean Execution
- **Location**: Phase 2 §1–2
- **Detail**: Through the action, most rows can never fire:
  - `validation_failed`: the action's Zod input already refuses anything over 72 bytes.
  - `weak_password` reasons: `pwned` needs HIBP, which is out of scope, and `characters` can't happen with `password_requirements = ""`.
  - The three toggle codes: the toggles are verified off. The catch-all INTERNAL row already surfaces GoTrue's own message, which names the condition.
  - Session-missing: only reachable through a race, because `requireSession` gates first.

  The plan still builds a new `shared/api/auth/` folder (mapper, `unwrapAuth`, barrel, a `shared/api` re-export) and adds two domain codes, all for one call site. `ui-conventions.md:117`, and the research itself (`research.md:458`), say to promote a helper when its second consumer arrives.
- **Fix A ⭐ Recommended**: A private mapper in `_pages/account/api/`:
  - `weak_password` and `same_password` → UNPROCESSABLE_CONTENT
  - `over_request_rate_limit` → TOO_MANY_REQUESTS
  - session-missing → UNAUTHORIZED (cheap insurance for the race)
  - anything else → INTERNAL with GoTrue's message

  The runbook lists the toggle codes. Promote to `shared/api` when S-402 arrives.
  - Strength: about half the code and tests; matches the house promote-on-second-use rule.
  - Tradeoff: S-402 moves the file later.
  - Confidence: HIGH — every dropped row was checked against the input schema and the config.
  - Blind spot: none significant.
- **Fix B**: Keep `shared/api/auth/`, but trim it to the rows above.
  - Strength: no move when S-402, S-409 and S-410 land.
  - Tradeoff: a shared surface with one caller, against the stated rule.
  - Confidence: HIGH.
  - Blind spot: S-402's needs are not designed yet.
- **Decision**: PENDING

### F3 — The actor parameter widens a shared contract; a column default avoids it

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architectural Fitness
- **Location**: Phase 2 §3; Phase 3 §2
- **Detail**:
  - `ui-conventions.md:160` says domain functions stay "(supabase, input)-shaped", and `define-domain-action.test.ts:99-116` pins that shape.
  - The plan widens `run` for 38 action definitions, and changes the return type of `requireSession`, for one function that needs the caller's id.
  - Whatever is chosen here also sets the precedent for S-407's `created_by`.
- **Fix A ⭐ Recommended**: Declare `user_id uuid primary key default auth.uid() references auth.users`. `updateDisplayName` upserts `{ display_name }` with `onConflict: "user_id"`. The RLS WITH CHECK still enforces ownership. Nothing in `shared/lib` changes.
  - Strength: zero plumbing change; the database knows who is calling. It also works for rows written inside RPCs, which S-407 will need.
  - Tradeoff: the first `auth.uid()` default in the schema. Factories must pass `user_id` explicitly, because the service role has no uid.
  - Confidence: MED — a PostgREST upsert whose conflict column is filled by a default should work, but nobody has run it.
  - Blind spot: Phase 3's suite must prove the upsert round trip before Phase 3 is called done.
- **Fix B**: Keep the actor parameter, and amend `ui-conventions.md` § Server actions in the same phase.
  - Strength: an explicit, unit-testable id.
  - Tradeoff: a shared contract change for one consumer.
  - Confidence: HIGH.
  - Blind spot: none significant.
- **Decision**: PENDING

### F4 — The weak-password nudge is a three-writer cookie machine

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Lean Execution
- **Location**: Phase 4 §2 (and Phase 3 §6 "stub now, wire later")
- **Detail**:
  - The pieces:
    - a cookie constant in `shared/config`
    - a cookie set and clear in `signin.ts`
    - a shell condition, plus an exception for `/account`
    - an inline dismiss script that writes `document.cookie`
    - `PasswordForm` writing the same cookie from React, through a stub that crosses phases
  - That is three writers of one piece of state, for a population the developer already knows.
  - Until S-401 nobody can change a password, so every hosted password is still the one the developer set (`author-provisioning.md` §b).
  - The plan already introduces "status through a query flag" for `?saved=name`. The nudge invents a second mechanism.
- **Fix A ⭐ Recommended**: `signin.ts` reads `data.weakPassword` and redirects to `/dashboard?notice=weak-password`, where `DashboardPage` renders the warning `Banner`. It shows again on each sign-in until the password changes.
  - This drops the cookie constant, the shell logic, the inline script and the React cookie writes. Testing step 4 already expects "sign in again → banner returns".
  - Strength: keeps the recorded decision, reuses the plan's own pattern, and has no client state at all.
  - Tradeoff: the banner leaves once the user navigates away; there is no dismiss that sticks for the session.
  - Confidence: HIGH.
  - Blind spot: none significant.
- **Fix B**: Drop the nudge. Instead, the Phase 5 runbook tells provisioned authors to change their password at `/account`.
  - Strength: the leanest option; the Banner rewrite also leaves this slice.
  - Tradeoff: it reverses a decision recorded in the brief, and relies on the developer contacting each user.
  - Confidence: MED — it assumes no hosted password was set outside the runbook.
  - Blind spot: the hosted user list was not checked.
- **Decision**: PENDING

### F5 — E2E isolation infrastructure guards against a leak that doesn't exist

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Lean Execution
- **Location**: Phase 4 §3–4
- **Detail**:
  - **No spec reads the sidebar footer.**
    - `auth.spec.ts:16-19` deliberately scopes its email check to the dashboard's `<header>`.
    - CI runs `workers: 1`.
    - The account spec sets its name and clears it again inside one test, and never submits a password.
  - **Yet the plan builds a second account across 6 infrastructure files**: the credentials array, the provisioning loop, a second setup test, the project and its testIgnore, `.gitignore`, and an `e2e/CLAUDE.md` paragraph.
  - **It also adds two guard spec files that cover no new code path.**
    - The action guard is the same `requireSession` inside `defineDomainAction`, already proven by `action-unauth.spec.ts` and `define-domain-action.test.ts:46-60`.
    - The redirect is the middleware's deny-by-default rule.
- **Fix**:
  - Run `account.spec.ts` in `chromium` on the shared author, and clear the name in a `finally`.
  - Add the `/account` redirect as a second `test` in `auth-guard.spec.ts`.
  - Drop `account-action-unauth.spec.ts` and the second account.
  - Add one line to `e2e/CLAUDE.md`: the account spec edits the shared author's display name, so don't assert on footer text.

  Notes:
  - Strength: about 8 fewer file changes, with the same proof of the UI wiring.
  - Tradeoff: a future spec that asserts on footer text must know about this.
  - Confidence: HIGH — checked: all footer/email selectors, the config and the importers.
  - Blind spot: S-402/S-409 will need throwaway users for password flows. That is their infrastructure, not this slice's.
- **Decision**: PENDING

### F6 — The name regex is written in invisible characters

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Completeness
- **Location**: Phase 1 §2 (`plan.md:106`, `:129`); Phase 3 §1 (`:303`)
- **Detail**:
  - The bytes at `plan.md:106` and `:303` are literal U+200B, U+200F, U+202A, U+202E, U+2066, U+2069 and U+FEFF characters, not escapes. Yet `:129` talks about "the `\u` escapes".
  - Copied as written, they put invisible text into a migration and a `.ts` file. Nobody can review it, and a diff shows nothing.
  - The defence is also written twice (a SQL CHECK and a Zod refine), with its own live test and unit tests. Meanwhile the PRD's mitigation for impersonation is the email shown beside the name (FR-413), which a bidi override in a separate element cannot fake.
- **Fix A ⭐ Recommended**: Keep the defence, but spell it out as escapes in one named, commented constant per side:
  - `​-‏`: zero-width characters and marks
  - `‪-‮`: bidi embeddings and overrides
  - `⁦-⁩`: isolates
  - `﻿`: byte-order mark

  Notes:
  - Strength: fixes the certain defect and keeps the decision.
  - Tradeoff: still two mirrored rules to keep in sync.
  - Confidence: HIGH.
  - Blind spot: the Postgres ARE `\u` escapes still need the live proof (see F7 for where it lives).
- **Fix B**: Drop the character class. Keep the CHECK as length 1–60 and trimmed, and Zod as trim + NFC + max 60 + `""` → `null`.
  - Strength: no mirrored regex, no live escape proof, fewer tests.
  - Tradeoff: zero-width look-alike names become possible; the email line is the only guard.
  - Confidence: MED — this is a product call.
  - Blind spot: none significant.
- **Decision**: PENDING

### F7 — CHECK and access claims proven twice, partly in the wrong suite

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Lean Execution
- **Location**: Phase 1 §7; Phase 3 §8 item 6
- **Detail**:
  - Phase 1 puts CHECK-constraint (`23514`) cells into the role matrix, which is an access-posture suite.
  - Phase 3 item 6 proves `23514` again. It also asserts "another user reads the row but its update affects 0 rows", which is an access claim in a new suite; CLAUDE.md says those belong only in the matrix.
- **Fix**:
  - The matrix keeps only access cells.
  - The CHECK is proven once, in the account suite: `updateDisplayName` with a raw (non-Zod) U+202E name raises `UNPROCESSABLE_CONTENT`, which proves the CHECK and the `23514` mapping together.
  - Drop item 6's access half, and the "CHECK-constraint cells" wording from step 1.5.
- **Decision**: PENDING

### F8 — The blocking hosted unknown is checked last

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Implementation Approach; Phase 5 §1 / step 5.3
- **Detail**:
  - The two hosted toggles are the brief's first open risk, and the only thing that can make the no-current-password design fail on hosted. Their read-only check (one Management API GET) sits in Phase 5.
  - The plan also calls every phase "independently mergeable". A Phase 3 merge would therefore put `/account` live on hosted before the floor is set or the toggles are verified.
  - Meanwhile Phase 5 says "before the PR merges", as if there were only one PR.
- **Fix**: Move the read-only GET, and setting the hosted floor, into the Prerequisites before Phase 1. State that the slice ships as one PR, or gate the merge that exposes `/account` on that check.
- **Decision**: PENDING

### F9 — Sign-in's adoption of PasswordInput has no contract

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 §4
- **Detail**:
  - The plan says "update `SignInForm.tsx` and `FormField.tsx`" and stops there.
  - `FormField` renders its own `<Input>`, with a left icon (`pl-10`) and an `endContent` prop whose only use is the toggle.
  - How sign-in swaps in a component that renders its own Input is left for the implementer to guess.
- **Fix**: When `type="password"`, `FormField` renders `PasswordInput` (forwarding `className` for the icon padding). Delete `endContent` and `SignInForm`'s `showPassword` state, so the change removes code. The "Show password" label stays, which keeps `auth.setup.ts:26-27` working.
- **Decision**: PENDING

### F10 — The profile read hides its failures; the label helper is promoted early

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architectural Fitness
- **Location**: Phase 3 §4–6; Phase 4 §1
- **Detail**:
  - `loadOwnProfile` both reads the row and decides what happens when the read fails (log, then null). Every sibling in `shared/api` throws through `unwrap*`.
  - That fallback policy then also applies on `/account`, where an empty field after a failed read looks like "no name".
  - It returns a `{ displayName }` wrapper around a single field.
  - `profileLabel` gets a new `shared/lib/profile/` folder "shared with the account page", but no account-page contract ever uses it.
  - Minor points:
    - the `n/60` live counter is gold plating;
    - `?saved=name` stays in the URL, so a later reload announces "saved" again.
- **Fix**:
  - `loadOwnProfile(supabase, userId): Promise<string | null>`, built on `unwrapMaybeRow` (throws).
  - `SidebarLayout` owns the try/catch → `null`.
  - `profileLabel` stays beside `SidebarLayout` until a second consumer appears.
  - Drop the counter.
- **Decision**: PENDING
