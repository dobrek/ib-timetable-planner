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
