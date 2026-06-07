---
change_id: app-shell
title: Authenticated app shell & navigation convention
status: implementing
created: 2026-06-07
updated: 2026-06-07
archived_at: null
---

## Notes

Precursor to S-02 (`course-catalog`). The app currently has **no navigation at all**: `Topbar` is used only in the marketing `Welcome.astro`; the planner (`/plans/[id]`) is an orphan with no link to it anywhere in the codebase (reachable only by typing a UUID URL); and `dashboard.astro` is a dead-end stub ("Welcome, {email}" + Sign out, links nowhere) that also violates the semantic-token rule (hardcoded `bg-white/10`, `from-blue-200`, …).

**Goal:** introduce a minimal, token-based authenticated **app shell** + navigation convention so there's a coherent user journey to reach the catalog and every future CRUD section (Teachers S-03, Students S-04, Import S-05, Plans), instead of each slice inventing its own nav or becoming another orphan island.

**Intended scope (keep minimal — a convention, not an IA redesign):**
- An authenticated `AppLayout` wrapping a persistent nav (the thin `Layout` stays for public/auth pages).
- Route convention for top-level sections (`/courses`, future `/teachers`, `/students`, `/plans`).
- Turn the dashboard stub into a real home that links into sections (and finally links to plans — killing the orphan), built token-based.
- Avoid gold-plating (no breadcrumbs / command palette / multi-level menus before the sections are known).

**Open research questions (settle in `/10x-research`):**
1. **Nav pattern — sidebar vs topbar vs other.** Needs elaboration of the trade-offs (scalability to 5–6 sections + cohort switcher, screen real-estate for a laptop authoring tool, shadcn `sidebar` primitive cost, MVP simplicity). NOT yet decided.
2. **Cohort context placement.** Courses (and later teachers/students) are `cohort_id`-scoped (Y1/Y2). Does the shell carry a **global cohort switcher** in the nav, or is cohort selected **per-page** inside each section? This interacts with the data model and with `course-catalog` open question #2.

**Related:** decided conventions for the catalog stream live in `context/changes/course-catalog/research.md` (Astro Actions + Zod 4 + RHF, validation, merge UX) and `context/foundation/lessons.md`. The token-discipline lesson directly applies to all new shell UI.
