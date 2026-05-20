---
starter_id: next
package_manager: npm
project_name: ib-schedule-planner
hints:
  language_family: js
  team_size: solo
  deployment_target: vercel
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: verified
  path_taken: custom
  quality_override: false
  self_check_answers:
    typed: true
    from_official_starter: true
    conventions: true
    docs_current: true
    can_judge_agent: true
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: false
  has_background_jobs: true
---

## Why this stack

Solo author shipping an IB timetable editor in 8 after-hours weeks with email+password auth, a validator-heavy drag-and-drop UI (≤200ms p95 per drop), and the option to precompute compatible groupings off the request path. Next.js was chosen over the (web, js) recommended default 10x-astro-starter because the user wanted full Node runtime — Astro's Cloudflare-edge default constrains long-running background work, and the user explicitly flagged background jobs as in scope. Next.js clears all four agent-friendly gates (typed via TypeScript, App-Router conventions, deep training-data corpus, current docs). T3 and React Router were considered as alternatives; the user preferred a bare Next.js base they can compose (Drizzle/Prisma + NextAuth + Postgres) without tRPC binding the client to the server's type graph. Vercel is the starter's deployment default and the cheapest path to the school's preview-demo milestone; auto-deploy on merge via GitHub Actions matches solo cadence. Self-check came back clean on all five points — no Socratic nudge fired.
