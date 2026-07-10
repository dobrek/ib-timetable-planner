---
date: 2026-07-10T12:13:06+02:00
researcher: Claude (Fable 5)
git_commit: e6ac2a170ccdcb645c388f086c29c8bc7d49e9fc
branch: main
repository: ib-timetable-planner
topic: "Feasibility of batch xlsx export: one operation producing the combined plan file plus one file per teacher"
tags: [research, codebase, xlsx-export, batch-export, cloudflare-workers, zip, plan-detail, teacher-plan-view, entities-timetable]
status: complete
last_updated: 2026-07-10
last_updated_by: Claude (Fable 5)
last_updated_note: "Added follow-up research: data-completeness verification on plan-detail + resolved all five open questions with the author"
---

# Research: Feasibility of batch xlsx export (combined plan + all teachers, one operation)

**Date**: 2026-07-10T12:13:06+02:00
**Researcher**: Claude (Fable 5)
**Git Commit**: `e6ac2a170ccdcb645c388f086c29c8bc7d49e9fc`
**Branch**: `main`
**Repository**: `dobrek/ib-timetable-planner`

## Research Question

Check the feasibility of a batch xlsx export for a plan: with **one operation**, create a file for the plan (**combined** version) and one file for **each teacher**. Students are deliberately skipped for now. The Worker runs on the Cloudflare **paid** plan (30-second limit cited); evaluate whether some other mechanism (queues, background jobs, etc.) is needed.

## Summary

**Feasible — and much simpler than the question anticipates.** The batch export should be **pure client-side**: loop the existing runtime-agnostic workbook builders (already shared by the three shipped export variants), produce one Blob per workbook, zip them with `fflate` (already in `node_modules` as `write-excel-file`'s sole dependency), and trigger a single `.zip` download. **The Worker — and therefore the 30-second limit — is not involved at all.**

Key facts supporting this:

1. **All three shipped exports (plan/teacher/student) already generate xlsx entirely in the browser** with `write-excel-file@^4.1.1`; there is no server-side export code. The pure builders in `src/entities/timetable/model/export/` were *deliberately* kept library-free and runtime-agnostic — the code comments explicitly anticipate a batch path.
2. **Scale is tiny**: ~16–18 teachers per cohort (~34 across both), grids of ~40×10 cells. An empirical benchmark run during this research measured **~85 ms total** for 1 combined plan workbook + 40 teacher workbooks + zipping (~217 KB archive). That is ~300× under any "few seconds" UX bar.
3. **The cited 30 s limit is CPU time, not wall-clock** — and it's raisable to 5 min via `limits.cpu_ms`. HTTP request wall-clock on Workers is unlimited while the client stays connected. Even a fully server-side version of this exact feature would use well under 1% of the CPU budget. **No queues, Workflows, R2, or `waitUntil` are needed**; they only become relevant for thousands of files, tens-of-seconds per-file compute, or a "store and share a link" requirement.
4. **One zip beats N downloads**: Chrome/Edge/Firefox block "multiple automatic downloads" after the first and prompt the user; a single zip is one download prompt and never trips it.

The genuinely new pieces are small: a batch assembly function (loop over teachers → `buildPerspectiveWorkbook`), a zip glue (`fflate.zipSync` at compression level 0, since xlsx is already deflated), a zip filename convention, and a UI entry point. Everything else is precedent.

## Detailed Findings

### 1. Current export architecture — fully client-side, deliberately staged for batch

Generation happens entirely in the browser React islands; no Astro Action or API route participates (the only API routes are `auth/signin.ts` / `auth/signout.ts`). The flow in every variant: SSR page loads data → island button click → pure builder returns `{ sheets, fileName }` → `writeXlsxFile(descriptors).toFile(fileName)` performs the Blob download → `sonner` toast on failure.

**Pure, library-free builders** live in `src/entities/timetable/model/export/` (barrelled via `src/entities/timetable/index.ts:19-24`):

- `sheet-types.ts:1-12` — locally-declared sheet types, deliberately NOT imported from the library; the comment explicitly cites "the future server-side batch-export path, a Worker route" as the reason.
- `timetable-sheet.ts` — `buildTimetableSheet`, the styled grid shared by all variants; combined mode renders two cohort sub-columns per day (`multi` at `timetable-sheet.ts:40`, cohort sub-label row at `:48,103-108`).
- `roster-sheet.ts` — `buildRosterSheet` (one cohort's full subject list).
- `perspective-course-sheet.ts` — per-course header + student roster sheet.
- `perspective-workbook.ts:47-60` — **`buildPerspectiveWorkbook`**, the persona-agnostic per-person workbook assembler returning `{ sheets: {name, sheet}[], fileName }`. **This is the natural reuse point for the batch loop.**
- `sheet-name.ts` — Excel sheet-name hygiene (sanitize `[ ] / \ : * ?`, ≤31 chars, case-insensitive dedupe) — historically flagged as the single highest-risk detail.

**The three shipped variants:**

| Variant | Entry point | Builder | Output |
|---|---|---|---|
| Plan (Combined/DP1/DP2) | `src/_pages/plan-detail/ui/chrome/ExportMenu.tsx:31-38` | `buildExportWorkbook` (`src/_pages/plan-detail/lib/export-workbook.ts:50-69`) | Grid sheet (`"Combined"` = both cohorts side-by-side) + one roster sheet per exported cohort |
| Teacher | `src/_pages/teacher-plan-view/ui/ExportTeacherPlanButton.tsx:59-88` | `buildPerspectiveWorkbook` with `omitTeacherKey` | Merged cohort-tagged `Timetable` grid + one sheet per conducted course |
| Student | `src/_pages/student-plan-view/ui/ExportStudentPlanButton.tsx:29-47` | `buildTimetableSheet` directly | Single grid sheet (out of scope here) |

"Combined" in code: `exportedCohorts()` (`export-workbook.ts:71-73`) returns `[dp1, dp2]` when `view === "combined"`, producing the two-sub-column grid plus **two** roster sheets.

The library binding is always a single leaf import (`write-excel-file/browser`) in the UI component — never in `entities`. Each of the three call sites duplicates the ~identical descriptor-mapping + `.toFile()` snippet (`ExportMenu.tsx:34`, `ExportTeacherPlanButton.tsx:75-82`, `ExportStudentPlanButton.tsx:33-41`); a batch change could extract this, but the FSD precedent is that page-slice glue stays slice-local.

### 2. Data scale — small, and the batch loop is trivial

From the `data/dp1` + `data/dp2` fixtures (reference-only; Supabase is runtime truth, but scale matches):

| Cohort | Teachers | Students | Subjects |
|---|---|---|---|
| dp1 | 16 | 26 | 20 |
| dp2 | 18 | 35 | 20 |

A full batch = 1 combined plan workbook + **~34 teacher workbooks**, each a ~40×10 grid sheet plus a handful of per-course roster sheets. Loader hard limits confirm the ceiling (teachers `.limit(500)` at `src/_pages/teacher-plan-view/api/loader.ts:145`).

Teacher enumeration already exists server-side: `fetchPlanTeachers` (`src/_pages/teacher-plan-view/api/loader.ts:137-149`) — `id, code, full_name` ordered by name, feeding `TeacherSwitcher.tsx`. Per-teacher narrowing is done in the page, not the query: `teacherCourses(...)` → `perspectivePlacements(...)` (`TeacherPlanPage.tsx:108-109,127,132`).

### 3. Measured performance — the whole batch is ~100 ms

Empirical benchmark run during this research (Node 24, `write-excel-file/node` + `fflate.zipSync`; browser engines are the same order of magnitude — script kept at the scratchpad path in Related Research):

- 1 plan workbook, 3 sheets (40×10 grid + two 60×6 rosters): **~13 ms**, 9.6 KB
- 40 teacher workbooks (one 40×10 sheet each): **~70 ms total** (~1.8 ms each)
- `zipSync` of all 41 files (store, level 0): **~1–3 ms**
- **Total: ~85 ms wall, ~217 KB zip**

At ~85 ms on the main thread, no Web Worker or progress UI is required; the loop won't visibly freeze the UI. The <200 ms drag-drop budget is untouched (export is click-driven, per the precedent recorded in every prior export plan).

### 4. The Cloudflare 30 s "limit" — a non-constraint, twice over

Verified against current Cloudflare docs (see Sources in Related Research):

- **30 s on the paid plan is CPU time per request, not wall-clock** — and it's configurable up to **5 minutes** via `limits.cpu_ms` in `wrangler.jsonc`.
- **HTTP request wall-clock is unlimited** while the client stays connected (cron/queue handlers cap at 15 min instead).
- Memory 128 MB per isolate; no enforced response-size limit.

Since generation stays in the browser, none of this applies. And even a hypothetical server-side variant (~85 ms CPU, ~217 KB response) would use <1% of the default budget.

**Async/offload mechanisms evaluated and rejected for this scale:**

| Mechanism | What it buys | Verdict |
|---|---|---|
| `ctx.waitUntil` | ≤30 s post-response work; needs R2 + client polling | Overkill |
| Queues + consumer Worker | Decoupled retries; 15 min consumer wall | Overkill |
| Workflows | Durable steps, 30 s CPU/step, 10k steps | Very overkill |
| R2 + signed URL | Artifact persistence / shareable links | Only if exports must be *stored/shared*, not merely downloaded |

These become relevant only if requirements change in kind: thousands of files, per-file compute in the tens of seconds, or "email me / share a link later."

### 5. Packaging: one zip, via fflate, compression level 0

- **`fflate` is already installed** — it is `write-excel-file`'s sole runtime dependency, so adding it as a direct dep costs ~0 bundle weight. Its sync API (`zipSync`) is the right one (the async API spawns Web Workers / `worker_threads` — unnecessary here and unavailable on workerd if code ever moves server-side).
- **Compression level 0 (store)**: xlsx files are already deflate-compressed zip containers; recompressing wastes CPU for ~0 size gain.
- `write-excel-file/browser` exposes **`.toBlob()`** alongside `.toFile()` (verified in the installed v4.1.1), so the batch loop collects Blobs and hands them to the zipper; a single `URL.createObjectURL` anchor click downloads the archive.
- **Why not N separate downloads**: Chrome/Edge/Firefox block "multiple automatic downloads" after the first file and show a permission prompt — a settings dance for every user. One zip = one download prompt.
- Alternatives noted for the record: `client-zip` (streaming WHATWG-Streams zip, best if archives ever got big), JSZip (works but buffers everything and is slower — no reason to pick it).

### 6. What is genuinely new (greenfield surface)

1. **Batch assembly function** — pure, in the owning slice's `lib/` (per the `export-workbook.ts` precedent): iterate teachers → narrow placements per teacher (`teacherCourses` + `perspectivePlacements`) → `buildPerspectiveWorkbook` → plus one `buildExportWorkbook(view: "combined")`. Skip-or-include decision needed for teachers with zero conducted courses (the single-teacher button disables itself in that case — `ExportTeacherPlanButton.tsx:100`).
2. **Zip glue + download** — `fflate.zipSync` level 0, object-URL anchor click, library bound only at the UI leaf.
3. **Zip filename convention** — nothing exists; `<plan-slug>-<something>.zip` following the `slugify` precedent (`src/shared/lib/slugify/`). Duplicate-filename hygiene inside the archive (two teachers with the same code) mirrors the sheet-name dedupe concern.
4. **UI entry point** — most natural: a new item in the plan-detail `ExportMenu` (it already models multi-variant export). Alternative: a button on the teacher-plan-view page. Decision for framing/planning.
5. **Data availability check** — the batch needs, client-side on whichever page hosts the button: both cohorts' catalogs, placements, teacher list with codes, and student names per course. The plan-detail board island already resolves teacher and student names for its roster sheets; whether its props cover *everything* `buildPerspectiveWorkbook` needs (e.g. teacher `code` for filenames) must be verified during planning. Note the semantic wrinkle: exporting from the board captures **live optimistic state including unsaved edits** (the recorded rationale for client-side export), whereas teacher pages render saved state.

## Code References

Permalink base: `https://github.com/dobrek/ib-timetable-planner/blob/e6ac2a170ccdcb645c388f086c29c8bc7d49e9fc/`

- [`src/entities/timetable/model/export/perspective-workbook.ts:47-60`](https://github.com/dobrek/ib-timetable-planner/blob/e6ac2a170ccdcb645c388f086c29c8bc7d49e9fc/src/entities/timetable/model/export/perspective-workbook.ts#L47-L60) — `buildPerspectiveWorkbook`, the persona-agnostic per-person assembler; the batch loop's core.
- [`src/entities/timetable/model/export/sheet-types.ts:1-12`](https://github.com/dobrek/ib-timetable-planner/blob/e6ac2a170ccdcb645c388f086c29c8bc7d49e9fc/src/entities/timetable/model/export/sheet-types.ts#L1-L12) — library-free sheet types; comment explicitly reserves the batch path.
- [`src/_pages/plan-detail/lib/export-workbook.ts:50-73`](https://github.com/dobrek/ib-timetable-planner/blob/e6ac2a170ccdcb645c388f086c29c8bc7d49e9fc/src/_pages/plan-detail/lib/export-workbook.ts#L50-L73) — `buildExportWorkbook` + `exportedCohorts` ("combined" = `[dp1, dp2]`).
- [`src/_pages/plan-detail/ui/chrome/ExportMenu.tsx:31-38`](https://github.com/dobrek/ib-timetable-planner/blob/e6ac2a170ccdcb645c388f086c29c8bc7d49e9fc/src/_pages/plan-detail/ui/chrome/ExportMenu.tsx#L31-L38) — plan export entry point; the likely home of the batch action.
- [`src/_pages/teacher-plan-view/ui/ExportTeacherPlanButton.tsx:59-88`](https://github.com/dobrek/ib-timetable-planner/blob/e6ac2a170ccdcb645c388f086c29c8bc7d49e9fc/src/_pages/teacher-plan-view/ui/ExportTeacherPlanButton.tsx#L59-L88) — single-teacher export flow to replicate per iteration.
- [`src/_pages/teacher-plan-view/ui/TeacherPlanPage.tsx:108-132`](https://github.com/dobrek/ib-timetable-planner/blob/e6ac2a170ccdcb645c388f086c29c8bc7d49e9fc/src/_pages/teacher-plan-view/ui/TeacherPlanPage.tsx#L108-L132) — per-teacher narrowing: `teacherCourses` → `perspectivePlacements`.
- [`src/_pages/teacher-plan-view/api/loader.ts:137-149`](https://github.com/dobrek/ib-timetable-planner/blob/e6ac2a170ccdcb645c388f086c29c8bc7d49e9fc/src/_pages/teacher-plan-view/api/loader.ts#L137-L149) — `fetchPlanTeachers`, the existing all-teachers enumeration.
- [`src/shared/lib/slugify/`](https://github.com/dobrek/ib-timetable-planner/blob/e6ac2a170ccdcb645c388f086c29c8bc7d49e9fc/src/shared/lib/slugify) — shared filename slugging (diacritics-folding) for the zip name.
- [`package.json:48`](https://github.com/dobrek/ib-timetable-planner/blob/e6ac2a170ccdcb645c388f086c29c8bc7d49e9fc/package.json#L48) — `write-excel-file@^4.1.1`, sole spreadsheet dep (its sole dep is `fflate`).
- [`wrangler.jsonc`](https://github.com/dobrek/ib-timetable-planner/blob/e6ac2a170ccdcb645c388f086c29c8bc7d49e9fc/wrangler.jsonc) — only an `ASSETS` binding; no R2/Queues/DO/Workflows (and none needed).

## Architecture Insights

- **The export stack was intentionally pre-staged for batch.** Three consecutive changes kept the sheet builders pure, library-free, and persona-agnostic precisely so a batch loop could reuse them; the batch change should honor that by adding only a thin loop + zip layer, not new builders.
- **FSD placement**: pure batch assembly → owning page slice's `lib/` (page-slice export glue is deliberately slice-local, not shared — re-standing on `entities` transforms is the precedent); library binding (`write-excel-file/browser`, `fflate`) only at the UI leaf; nothing new in `entities` unless a builder gap is found.
- **Client-side-first is the recorded architectural decision** for exports (bypasses all Worker limits, uses already-hydrated live board state, keeps export a pure `model/`/`lib/` transform). Batch fits it; server-side remains a documented fallback (`write-excel-file/universal`, middleware already auto-gates a future `/api/export` route), not the default.
- **Naming conventions are fixed by precedent**: files `<plan-slug>-<view|teacher-code>.xlsx`; grid sheet `Timetable`/`Combined`; per-course tabs `Name · DPx` (≤31 chars, deduped); export buttons ghost `size="icon"` + lucide `Download` + `sonner` failure toast.

## Historical Context (from prior changes)

- `context/archive/2026-07-07-export-to-xlsx/research.md:69-98` — client-side vs server-side analysis; library comparison rejecting exceljs (~256 KB, Node deps, unmaintained), SheetJS CE (no styling, stale npm + CVE tripping the `pnpm audit` CI gate), xlsx-js-style; Workers limits table. `research.md:156` (Open Question #6) records the **batch design constraint**: grid→workbook assembly must stay pure and runtime-agnostic for a future batch path.
- `context/archive/2026-07-08-teacher-export-plan-to-xlsx/research.md:139-144` — "Server-side batch reuse — unblocked, and how to keep it that way": middleware auto-gates `/api/export`; `nodejs_compat` on; notes that a true all-teachers batch "might later want R2/a queue for staging + large payloads" (superseded by this research: measured scale makes that unnecessary); dev-SSR would need `write-excel-file/universal` in `ssrPrebundleDeps`.
- `context/archive/2026-07-08-student-export-plan-to-xlsx/plan.md:50-82` — `slugify` extraction to `src/shared/lib/slugify/`; student variant out of scope here but confirms the filename pattern.
- `context/archive/2026-07-09-printable-version/plan.md:75-77` — batch **PDF** ("all 40 teachers in one file") explicitly parked as a separate future change with Cloudflare Browser Rendering as its tool; xlsx remains "the sanctioned high-fidelity board artifact" (`plan.md:84`). This change is the xlsx sibling of that parked idea.
- `context/foundation/roadmap.md:217` — "PDF-generation pipeline / batch export" parked in the roadmap.

## Related Research

- `context/archive/2026-07-07-export-to-xlsx/research.md` — foundational export feasibility (library choice, client-vs-server).
- `context/archive/2026-07-08-teacher-export-plan-to-xlsx/research.md` — perspective-workbook reuse map and batch-readiness notes.
- Benchmark script from this session: `/private/tmp/claude-501/-Users-dobrek-Projects-10xdev3/10f42b71-ff4d-4bd6-a77e-1718176526ca/scratchpad/xlsx-bench/bench.mjs` (session-scratchpad; re-derivable).
- External sources: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) · [Workflows limits](https://developers.cloudflare.com/workflows/reference/limits/) · [Workers Node.js compat](https://developers.cloudflare.com/workers/runtime-apis/nodejs/) · [write-excel-file](https://gitlab.com/catamphetamine/write-excel-file) · [fflate](https://github.com/101arrowz/fflate) · [client-zip](https://github.com/Touffy/client-zip) · [Chrome multiple-download blocking](https://www.howtogeek.com/428416/how-to-enabledisable-multiple-file-downloads-in-chrome/)

## Open Questions

All five original open questions were resolved on 2026-07-10 — see **Follow-up Research** below for the verification evidence and the recorded decisions. No open questions remain.

## Follow-up Research 2026-07-10 (afternoon)

### Data-completeness verification: hosting the batch on plan-detail

Verified by direct code inspection what the plan-detail board island has versus what a per-teacher `buildPerspectiveWorkbook` call needs (`src/entities/timetable/model/export/perspective-workbook.ts:18-35` — `PerspectiveWorkbookInput`).

**Already available on plan-detail** (`src/_pages/plan-detail/api/load.ts:93-141`, `PlannerBoard.tsx:163-173`):

- Per-cohort catalogs as `GroupingCourse[]` carrying **`teacherKeys` and `studentKeys` per course** (`src/shared/lib/catalog-hash/types.ts:19-26`) — so per-teacher course membership (`memberOf`) is derivable client-side without new queries.
- Live placements including unsaved optimistic edits (`exportCohort` reads `state.placements`), `courseDisplay`, per-cohort `studentNames`, `teacherNames` (union of both cohorts), `hours` (board state), `days`/`periods`, plan name.

**Missing on plan-detail — the SSR loader must be extended with three items:**

1. **Teacher codes** — `buildPerspectiveWorkbook` needs `fileCode` (the teacher code) for `<plan-slug>-<code>.xlsx` filenames (`perspective-workbook.ts:58`). Plan-detail only loads display names: `loadTeacherNames` returns `Record<teacherId, full_name ?? code>` (`src/shared/api/load-teacher-names.ts`) — the code itself is not carried. The `fetchPlanTeachers` query (`src/_pages/teacher-plan-view/api/loader.ts:137-149`) is the pattern to reuse (`id, code, full_name`, ordered, `.limit(500)`).
2. **Course merges** — `buildPerspectiveCourseItems` requires `merges: CourseMerge[]` (`src/entities/timetable/model/perspective-course-list.ts:35-42`); only the teacher- and student-plan-view loaders call `loadCourseMerges` (`src/shared/api/load-course-merges.ts:13`), plan-detail does not.
3. **Course levels** — `PerspectiveWorkbookInput.courseLevels` feeds the per-course sheet headers; `GroupingCourse` has no `level` field. `TeacherPlanPage.tsx:105-106` derives it from the loader's `courseInfo`; plan-detail loads no equivalent.

The teacher-plan-view loader already has all three — but it renders **saved** state, whereas the board exports **live optimistic** state, which coupled the placement decision to the state-semantics decision (resolved below: board + live state, matching the existing plan export's recorded rationale).

### Decisions (author, 2026-07-10)

| # | Question | Decision |
|---|---|---|
| 1 | UI placement | **Board `ExportMenu`** — add a "Download all (zip)" item to the existing Combined/DP1/DP2 dropdown; extend the plan-detail SSR loader with teacher codes, course merges, and course levels. |
| 2 | Zero-course teachers | **Skip them** — the archive contains only meaningful files, mirroring the single-teacher button's self-disable (`ExportTeacherPlanButton.tsx:100`). |
| 3 | State semantics | **Live board state** (including unsaved optimistic edits) — identical semantics to the existing single plan export from the board; what you see is what you export. |
| 4 | Zip layout & naming | **Flat, existing conventions**: `<plan-slug>.zip` containing `<plan-slug>-combined.xlsx` + `<plan-slug>-<teacher-code>.xlsx` per teacher; in-archive filename collisions deduped with a numeric suffix. |
| 5 | Data completeness | Verified above — three loader additions (teacher codes, merges, levels); builders stay untouched. |

### Implications for the plan

- The work concentrates in the `plan-detail` slice: loader extension (`api/load.ts`), a pure batch-assembly function in `lib/` (loop: derive each teacher's courses from `teacherKeys` → narrow live placements → `buildPerspectiveCourseItems` → `buildPerspectiveWorkbook`; plus one `buildExportWorkbook("combined")`), zip glue + `fflate` binding at the `ExportMenu` leaf.
- `entities/timetable` needs no changes — the skip-empty-teachers rule keeps the builders' "at least one course" assumption intact.
- The three loader additions are small reads (one `teachers` select, `loadCourseMerges`, level projection); they run SSR alongside the existing parallel fetches and do not touch the drag-drop hot path.
