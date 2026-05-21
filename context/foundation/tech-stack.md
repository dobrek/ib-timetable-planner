---
starter_id: 10x-astro-starter
package_manager: pnpm
project_name: ib-schedule-planner
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-pages
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: first-class
  path_taken: standard
  quality_override: false
  self_check_answers: null
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: false
  has_background_jobs: false
---

## Why this stack

Solo author building IB Schedule Planner after-hours over an 8-week MVP for an
internal school demo. The PRD asks for email/password auth, durable persistence
of catalog + placements, a drag-and-drop grid with sub-200ms client-side
validation, and CSV import/export — no payments, no realtime, no LLM step, no
background queues. 10x-astro-starter is the recommended default for `(web, js)`
and clears all four agent-friendly gates (typed via TypeScript + Zod,
convention-based via Astro routing, popular in JS training data, well-documented).
It ships Supabase Postgres + auth for the catalog and identity, and Cloudflare
Pages/Workers for the edge runtime, matching the chosen deployment target.
Bootstrapper confidence is first-class — expect mostly smooth scaffolding with
occasional manual steps. CI runs on GitHub Actions with auto-deploy on merge to
main, which fits a solo after-hours cadence. The combinatorial compatible-
groupings computation and the live drop validator both run in-process (server
function + client-side island over the loaded catalog), so no background-job
infrastructure is needed in MVP.
