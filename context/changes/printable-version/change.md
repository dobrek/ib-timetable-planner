---
change_id: printable-version
title: Printable version
status: implementing
created: 2026-07-09
updated: 2026-07-10
archived_at: null
---

## Notes

**Product decision (2026-07-09):** We are OK overriding the PRD "Printable / PDF export"
Non-Goal for this change. The goal is to make the **application print-friendly** via
browser-native print (CSS `@media print` + `window.print()` / the browser's Save-as-PDF) —
**not** to build a custom, dedicated view or PDF-generation pipeline. Prefer CSS that cleans
up the real pages for paper over bespoke print components/routes. Plan should amend
`prd.md`/`roadmap.md` to reflect the Non-Goal override.

**Board pagination decision (2026-07-10, Phase 4):** The fixed print-scale **fallback was
applied**, not plain fit-to-page. Measured empirically: the combined dp1|dp2 × 5-day grid is
~1232px wide at 100% print — wider than the ~1032px A4-landscape printable width (297−24mm
@96dpi) — so at 100% it clips the rightmost column. A fixed `zoom: 0.8 !important` on
`[data-slot="planner-grid"]` under `@media print` scales the grid subtree to ~1010px so it
fits one landscape page width (measured 1016px ≤ 1032px). Focus (single-cohort) mode is well
within width at the same scale.

**Verification note (Phase 5):** The dark-neutralization e2e gate initially passed vacuously —
Chromium serializes the resolved `--background` as an OKLCH lightness that Lightning CSS can
render as a percentage (`oklch(14.5% 0 0)`), which a naive numeric guard reads as "light". The
assertion was rewritten to normalize the body's resolved `background-color` lightness to a 0–1
scale (handling `oklch` decimal/`%` and `rgb`), and a mutation test (dropping `--background`
from the `.dark` print re-declaration) confirmed it now **fails** on a dark body — the gate
bites.
