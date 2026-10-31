---
change_id: viewer-read-only
title: S-405 viewer role: read every plan and proposal, no edit affordances
status: impl_reviewed
created: 2026-10-30
updated: 2026-10-31
archived_at: null
---

## Notes

as S-405 from @context/foundation/roadmap.md

## Decisions

- **2026-10-30: Open Question 1 is (a), wait for an author.** A viewer's visit never delivers or writes. A finished, undelivered proposal shows as finished and waiting for an author, and its board appears once an author or admin opens it. Accepted cost: until then, that proposal's board, comparison and perspective views are closed to a viewer, so FR-409's "every proposal" means every delivered one. No migration, no RLS change, no new DEFINER function. Recorded in PRD Open Question 1 and the roadmap (S-405 is no longer blocked). Research: `research.md` §5 and its follow-up.
- **2026-10-31: `generation.viewer.spec.ts` reroutes the author's one post-Generate read** (impl review F3). The source board makes a single `checkPlan` read right after Generate, and a solve that finishes in about a second could be delivered by it before the viewer ever sees "waiting for an author". So, on the author's source page only, that request is rerouted to `readPlanJob`, the write-free twin that returns the same view. The proposal's URL is read from the viewer's hub, because an editor's strip shows nothing for a finished, undelivered job. The viewer's page is never intercepted, so a viewer regression to `checkPlan` still fails the spec. It is the first e2e spec to intercept a request.
- **2026-10-30: `planFileStem` lives in `src/shared/lib/slugify/`, not a new `shared/lib/plan-file-stem/`** (Phase 4; recorded on 2026-10-31 per impl review F7). A new folder would have taken `shared/lib` to 16 modules, past steiger's `fsd/shared-lib-grouping` limit of 15, which CI runs with `--fail-on-warnings`. The stem is built on `slugify`, so it sits beside it as its own concept file (`plan-file-stem.ts`), exported from that folder's barrel.
- **2026-10-31: the `-current` stem can collide, accepted.** A non-current plan named "X current" exports as `x-current-…`, the same stem as the current plan "X". Disambiguating would need a separator that `slugify` cannot produce, for a case that needs a plan named after the marker itself. The file name is a convenience label, a snapshot taken at export (the plan's Critical Implementation Details), and the plan's name inside the app is the source of truth.

## Browser verification of the manual rows (Playwright, local)

On 2026-10-30, on `pnpm build && pnpm preview` (workerd) at HEAD `2699676`, against the local stack with the native solver up. The viewer is the e2e account `e2e-viewer@example.test` and the author is `e2e-author@example.test`, each in its own `playwright-cli` session. Throwaway Playwright scripts arranged the data through the author's UI and `e2e/support` helpers. Every plan they created was deleted through the app afterwards, leaving only Seed Plan A and Seed Plan B. **This is evidence for the human sign-off.** The user signed off on 2026-10-30, and the Manual Progress rows are checked, each with its phase's commit.

- **1.8:** A finished, undelivered proposal, opened by the viewer:
  - The status reads "Finished — waiting for an author", followed by "This proposal has finished. Its board appears here once an author or admin opens it."
  - The page's only buttons are Toggle sidebar, Toggle theme, Sign out and Refresh. There is no Stop.
  - Server log, from baseline to the end of the walk: no 42501 and no `[checkPlan]` or `[plans/:id]` error. The only failures are 4 `auth.getUser failed: Auth session missing!` lines, from the two signed-out `playwright-cli open` calls made before each session loaded its storage state.
  - The viewer's polls went through `readPlanJob` only.
- **1.9:** With the viewer's tab open, the author opened the proposal, and the viewer's untouched page turned into the board on its own. `notified_at` was stamped by the author's visit only.
  - First walk: 7 s from the start of the author's navigation. That includes the author's page load and the delivery.
  - Re-timed: the viewer's page flipped **4.85 s** after the author's delivered board was on screen (the author's navigation took 0.3 s). That is within the 5 s poll interval.
- **1.10:** A proposal delivered by an author's visit to its source, so `notified_at` was still null:
  - Its hub badge reads "Ready — open" for the viewer.
  - It still reads "Ready — open" after the viewer opened the delivered board.
  - The database confirms `notified_at` is still null.
- **2.6:** On Seed Plan A, which has no groupings, the viewer's board renders combined (100 cells) and in both focus modes (50 cells each), with no compute prompt and no palette. The author's `?focus=dp2` on the same plan shows the compute prompt instead of the grid.
- **2.7:** On the current proposal's board, the viewer's snapshot has none of these:
  - Generate, Undo/Redo, palette, Shelf;
  - `Actions for …` chip menus, Week A/B radios;
  - Duplicate, Lift to shelf, Remove all, parked button, Compute groupings.

  Every placed chip carries `aria-disabled="true"` from dnd-kit, and its cursor is pointer, not grab. The only buttons are navigation, Highlight (lens), Board settings, Export plan and Print. ⌘Z, Ctrl+Z, ⌘⇧Z and Ctrl+⇧Z, pressed on a delivered proposal's board:
  - fired no `/_actions/` request;
  - left the board unchanged (4 chips, same cells);
  - were not intercepted (`defaultPrevented` false on every `z` keydown).

  There are no Undo/Redo buttons.
- **2.8:** On a colliding two-occupant cell, the viewer could do every read action:
  - Ungroup toggles to "Group slot".
  - "Show collision details" opens the "Collisions — Wed P5" inspector.
  - The lens highlights DP1 and dims DP2.
  - Zoom moves from 1 to 1.05.
  - The hint-mode tabs ("Mark collisions" / "Highlight free") are present.
  - Export downloads `…-current-combined.xlsx` and the zip `…-current.zip`.
  - Print: the button calls `window.print()` (stubbed to count the call, so no dialog opened). The printed result is checked under 4.7.
  - **Finding (accessibility; fixed on 2026-10-31 by impl review F1: a viewer's board now runs without dnd-kit's Accessibility plugin, so its cells and chips carry no `aria-disabled`):** the controls inside the viewer's cells and chips are exposed as **disabled** in the accessibility tree. That covers Group/Ungroup and "Show collision details", and Playwright refuses to click them. They work with a real pointer and stay focusable, but a screen reader announces them as unavailable.
  - Cause: dnd-kit's accessibility plugin writes `aria-disabled="true"` onto a disabled draggable's activator (the gridcell, or the chip), and descendants inherit it.
  - This predates S-405 for authors. An author's exploded cell reads "Group slot [disabled]", and a bundled cell's "Show collision details" reads `[disabled]`. `e2e/support/board.ts` already documents it: `clickBundleToggle` clicks with `force: true` for exactly this reason.
  - S-405 makes every viewer cell and chip a disabled draggable, so it now covers all of a viewer's in-cell read controls.
  - A follow-up would stop a disabled draggable from setting `aria-disabled`, or not register viewer cells as draggables at all. Either touches the author's drag path.
- **2.9:** The author's board is unchanged: Generate, Undo, the palette toggle and chip menus are present, and chips report `aria-disabled="false"`. The full author e2e suite passed 59/59, `drag-validate-feedback` included.
  - Drag latency, timed in the page from `pointerup` to the chip rendered in the target cell: palette → cell **13–15 ms**, and cell → cell (bundle move) **16 ms**. The budget is 200 ms.
- **3.6:** On `/plans`, the viewer has no "New plan" and no `Actions for …` row menus. Every row has its Select checkbox, and Compare works (see 4.6). A waiting proposal reads "Finished — waiting for an author" and links to `/plans/<proposal id>`; a delivered one reads "Ready — open".
- **3.7:** On Seed Plan A, as the viewer:
  - **Courses:** no New button and no row menus. The overlap badge, "View overlaps for Biology", opens "Overlaps — Biology", which lists "Biology (SL)" with only Close. The author's dialog lists the same entry, plus the combobox, Add and remove.
  - **Teachers and students:** no New button and no selection checkboxes. The row menu holds only "View plan", and it opens the student's perspective view.
  - **Availability:** for a constrained teacher, the badge "View availability for MB… (1 constrained cells)" opens the grid "Availability — MB…", which has 50 named, non-interactive cells. "Mon P1: soft (prefers not)" matches the author's edit. The only buttons are Done and Close, both of which only close.
- **3.8:** The author's hub has "New plan", 12 row menus and no "View only" chip. The author's catalogs are unchanged; their e2e specs passed.
- **4.6:** Comparing the current proposal with its non-current source shows "Current plan" in the proposal's column headers only. The columns keep the URL's order.
- **4.7:** Under print media, one "Current plan" badge is visible on each of the current plan's board heading, student view and teacher view. The non-current source shows none.
- **4.8:** The current plan's tab titles end "· Current" on the board, the student view and the teacher view. The source's title does not. Exports are named `proposal-e2e-mv-current-…-current-combined.xlsx` and `…-current.zip`.
- **4.9:** The viewer's sidebar footer shows the outline "View only" chip with an eye icon. On the collapsed rail it shows the icon alone, and the name stays in the accessibility tree.
  - Neither the author's footer nor an admin's has the chip, expanded or collapsed.
  - The admin check promoted the e2e author with `scripts/assign-role.mjs … admin`, then restored it to `author`. The admin's hub kept "New plan" and its row menus.
- **5.5:** Covered by Phase 5's deliberate-break gate. With Generate un-gated for viewers, `read-only.viewer.spec.ts` failed on `getByRole('button', { name: 'Generate plan' })` (expected 0, received 1). The change was reverted, the app rebuilt and the spec re-run green.
- **5.6:** The agent read `e2e/CLAUDE.md`, the `CLAUDE.md` § Roles bullet and the `README.md` § Auth routes line, and checked their claims against the repo:
  - 32 specs;
  - three setup files;
  - the provisioner resets the viewer to `viewer` on every run;
  - `canEdit` comes from `allows(Astro.locals.access, "edit")`;
  - `readPlanJob` vs `checkPlan` as described.

  Whether the wording reads well is still for a human to judge.
