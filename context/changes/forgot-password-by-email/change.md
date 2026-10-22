---
change_id: forgot-password-by-email
title: Forgot password by email (S-402)
status: impl_reviewed
created: 2026-10-19
updated: 2026-10-22
archived_at: null
---

## Notes

as S-402 from @context/foundation/roadmap.md

- Shipped in PR #162 (merged 2026-10-20). Hosted gate, developer-inbox smoke and Workers Logs check
  recorded in `smoke.md`.
- **Gate ordering broken (impl review, 2026-10-22):** the plan put the hosted gate (Progress
  4.3–4.5) before the merge (4.6). 4.4 and 4.5 were done right after the merge instead, and the
  first production reset email (2026-10-20 14:03 UTC) used Supabase's default
  `{{ .ConfirmationURL }}` template, a link a scanner spends on GET, until the template sync took
  effect around 14:35 (`smoke.md` § 5.1). The gate also lacked a real-email check: a read-back
  proves what is stored, not what the next email holds. Before merging code that relies on a new or
  changed hosted template (S-410 `invite`, S-411 `email_change`), send one real email from the
  dashboard and read it.
- **Open at close (2026-10-22):** Progress 5.3 and 5.4 — the coordinator's M365 smoke test and the
  Safe Links scanner verdict — deferred because the school inbox is not available yet. Run them
  before archiving, or archive with them open as known pending items.
- Post-merge fix on the close-out branch: a password change is confirmed above the account forms
  (`/account?saved=password`), like a name save, instead of a toast.
