---
change_id: forgot-password-by-email
title: Forgot password by email (S-402)
status: implemented
created: 2026-10-19
updated: 2026-10-22
archived_at: null
---

## Notes

as S-402 from @context/foundation/roadmap.md

- Shipped in PR #162 (merged 2026-10-20). Hosted gate, developer-inbox smoke and Workers Logs check
  recorded in `smoke.md`.
- **Open at close (2026-10-22):** Progress 5.3 and 5.4 — the coordinator's M365 smoke test and the
  Safe Links scanner verdict — deferred because the school inbox is not available yet. Run them
  before archiving, or archive with them open as known pending items.
- Post-merge fix on the close-out branch: a password change is confirmed above the account forms
  (`/account?saved=password`), like a name save, instead of a toast.
