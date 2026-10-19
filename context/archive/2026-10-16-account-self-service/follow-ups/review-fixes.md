# Review follow-ups: account-self-service

Queued from `reviews/impl-review.md` triage (2026-10-19). Each item is deferred to a later slice, not fixed in this change.

- [ ] **U+061C in the display-name rule (F4).** The Arabic Letter Mark is the same kind of invisible bidi mark as the refused U+200E/U+200F, but neither the `profiles` CHECK (`supabase/migrations/20261017170524_profiles.sql:41`) nor `FORBIDDEN_NAME_CHARACTERS` (`src/_pages/account/model/schemas.ts`) refuses it. Fix it in the next migration that touches `profiles` (S-406), as an **added** CHECK constraint (migrations are additive only), together with the Zod regex and a schemas test case. Low impact: the email always renders beneath the name in its own element.
