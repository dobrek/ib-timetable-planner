# Printable Version — Plan Brief

> Full plan: `context/changes/printable-version/plan.md`
> Research: `context/changes/printable-version/research.md`

## What & Why

Make the whole application **print-friendly via browser-native print** — a global `@media print`
stylesheet plus a small per-page **Print** button calling `window.print()` — so a plan author can
"Save as PDF" or print any meaningful page. No PDF-generation library, no bespoke print views: we
clean up the *real* pages for paper. This overrides the PRD "Printable / PDF export" Non-Goal (an
approved product decision), reframing it as "print-friendly in scope; PDF-generation *pipeline* still
out."

## Starting Point

The perspective pages (student & teacher schedules) were architected print-ready — pure SSR islands
whose full grid + course list are already in the initial HTML. The board is the hard one: its only
side-by-side dp1|dp2 layout is the interactive editing grid (inline `zoom`, sticky headers, inside a
scroll shell). Zero print infrastructure exists today, but Tailwind v4's `print:` variant is
available out of the box.

## Desired End State

From any page, the author hits Print (or Cmd/Ctrl-P) and gets a clean ink-on-white document: no
sidebar/breadcrumb/banner/switcher/export/drag chrome — just the real content (schedule grid + course
list, or catalog table), A4 landscape, subject colors intact, correct across pages, identical whether
the session was light or dark mode.

## Key Decisions Made

| Decision                        | Choice                                             | Why (1 sentence)                                                                 | Source   |
| ------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------- | -------- |
| Overall approach                | Browser-native `@media print` + `window.print()`   | Understands the real OKLCH CSS; zero bundle/server; PDF libs are a poor fit.      | Research |
| Two-cohort board                | Best-effort CSS on the live board **now**          | Ships all three schedule surfaces; matches the "no bespoke view" product decision.| Plan     |
| Catalog lists + dashboard       | Include (verify-only)                              | They print for free once the shell block exists; avoids a jarring coverage gap.   | Plan     |
| Trigger UX                      | Print button per page (shared component)           | Discoverable; mirrors the existing export-button placement.                       | Plan     |
| Color handling                  | Force light subject tokens + `print-color-adjust: exact` | High-fidelity, dark-mode-safe; the `SUBJECT_COLOR_HEX` mirror already exists. | Plan     |
| Testing                         | Playwright print-emulation e2e                     | Real regression gate against chrome leaking into print; CI already runs Playwright.| Plan     |
| PRD/roadmap Non-Goal            | This change owns the amendment                     | The override is a product decision that must be recorded, not silent.             | Research |

## Scope

**In scope:** global print CSS (unclip, dark-neutralize, color-exact, `@page` A4 landscape); hide
shell chrome + portalled overlays; shared `PrintButton`; student + teacher + board wiring; catalog +
dashboard fall out free; PRD/roadmap amendment; print-emulation e2e.

**Out of scope:** PDF-generation pipeline (jsPDF/react-pdf/Cloudflare Browser Rendering); bespoke
print components or `/print` routes; batch "all-teachers-in-one-PDF"; mono-only redesign; changes to
the xlsx export; new data loaders.

## Architecture / Approach

Global-first. One `@media print` block appended to `global.css` carries page geometry, dark-token
re-declaration, `print-color-adjust: exact`, overlay hiding, and the board grid resets; inline
Tailwind `print:` utilities handle the structural unclip on the two shared layouts. A stateless
`shared/ui/PrintButton` (calls `window.print()`, self-hides under print) is dropped into each page
header beside the export button. Perspective pages hide their controls and flatten the teacher's
collision badges; the board additionally hides palette/shelf/toolbar and neutralizes zoom/sticky/
overflow on the live editing grid.

## Phases at a Glance

| Phase                                | What it delivers                                            | Key risk                                             |
| ------------------------------------ | ----------------------------------------------------------- | ---------------------------------------------------- |
| 1. Amend PRD + roadmap Non-Goals     | Recorded product mandate; `change.md` → planned             | None (docs only)                                     |
| 2. Global print foundation           | Shell unclipped/neutralized; catalog + dashboard print free | Missing a token → white-on-dark; cascade specificity |
| 3. Perspective pages + Print button  | Student & teacher print cleanly; shared `PrintButton`       | Teacher badge flatten touches a shared widget        |
| 4. Board best-effort print CSS       | Board prints "cleaned up for paper" + its Print button      | **Wide grid pagination in landscape (unvalidated)**  |
| 5. Print-emulation e2e               | Automated chrome-hidden/content-visible gate                | Emulation ≠ true paper render (fidelity still manual)|

**Prerequisites:** local Supabase + seeded plan for print-preview and e2e; nothing else.
**Estimated effort:** ~2–3 sessions across 5 phases (Phases 1–3 small; Phase 4 the real work; Phase 5
mechanical on existing e2e infra).

## Open Risks & Assumptions

- **Board pagination** is the one genuine unknown: dp1+dp2 × 5 days is wider than A4 landscape.
  Best-effort target is browser fit-to-page after unclipping; fallback is a fixed print-scale on the
  grid, resolved empirically in Phase 4 (a documented go decision, not a blocker).
- **`print-color-adjust: exact`** relies on the user enabling "background graphics" on physical
  printers; Save-as-PDF honors it automatically. B&W printers render chips as gray fills (color-coding
  degrades, course names remain).
- Dark-token neutralization must re-declare the **full** token set — a missed token prints
  white-on-dark.

## Success Criteria (Summary)

- Every meaningful page (three schedules + catalog lists + dashboard) prints clean, ink-on-white, with
  no interactive chrome, from a discoverable Print button or Cmd/Ctrl-P.
- Output is correct regardless of light/dark session and paginates without first-page clipping.
- A Playwright print-emulation suite gates the chrome-hidden / content-visible contract in CI.
