---
id: gated-author-provisioning
title: Gated author provisioning (close open registration)
roadmap_ref: F-01
prd_refs: [FR-001, "NFR Data privacy", "Access Control"]
status: archived
created: 2026-05-29
updated: 2026-06-12
archived_at: 2026-06-12T10:41:00Z
---

# Gated author provisioning

Close the currently-open self-service registration so only an author created by
someone with access (manually, in Supabase Studio / the hosted dashboard) can hold
an account. Foundation slice F-01 from `context/foundation/roadmap.md` — prerequisite
for every slice that touches student PII.

## Decisions (settled during `/10x-plan`)

- **Gate mechanism:** manual author creation in Supabase Studio / hosted dashboard. No in-app signup, no service-role key, no allow-list table.
- **Signup surface:** removed entirely (page, form, API endpoint, orphaned confirm-email page, and all links to it).
- **Route protection:** deny-by-default in middleware — every route requires auth except an explicit public allowlist.
- **Bootstrap author:** documented manual runbook step.
- **Enforcement:** app layer + Supabase config (`enable_signup = false`); hosted toggle documented.
- **Prod scope:** local enforced + verified; prod closure captured as a runbook the author executes.

See `plan.md` for the implementation contract and `plan-brief.md` for the two-page summary.
