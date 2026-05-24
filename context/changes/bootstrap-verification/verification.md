---
bootstrapped_at: 2026-05-21T00:00:00Z
starter_id: 10x-astro-starter
starter_name: "10x Astro Starter (Astro + Supabase + Cloudflare)"
project_name: ib-timetable-planner
language_family: js
package_manager: pnpm
cwd_strategy: git-clone
bootstrapper_confidence: first-class
phase_3_status: ok
audit_command: "npm audit --json"
---

## Hand-off

Verbatim copy of `context/foundation/tech-stack.md`:

```yaml
starter_id: 10x-astro-starter
package_manager: pnpm
project_name: ib-timetable-planner
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
```

### Why this stack (verbatim)

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

## Pre-scaffold verification

| Signal      | Value                                                     | Severity | Notes                                                            |
| ----------- | --------------------------------------------------------- | -------- | ---------------------------------------------------------------- |
| npm package | not run                                                   | n/a      | cmd_template starts with `git clone`; no `create-*` CLI to probe |
| GitHub repo | przeprogramowani/10x-astro-starter last pushed 2026-05-17 | fresh    | 4 days before bootstrap; resolved from card.docs_url             |

## Scaffold log

**Resolved invocation**: `git clone https://github.com/przeprogramowani/10x-astro-starter .bootstrap-scaffold && cd .bootstrap-scaffold && pnpm install`
**Strategy**: git-clone
**Exit code**: 0
**Files moved**: 20 top-level entries from `.bootstrap-scaffold/` into cwd (`.env.example`, `.github/`, `.husky/`, `.nvmrc`, `.prettierrc.json`, `.vscode/`, `README.md`, `astro.config.mjs`, `components.json`, `eslint.config.js`, `node_modules/`, `package-lock.json`, `package.json`, `pnpm-lock.yaml`, `public/`, `src/`, `supabase/`, `tsconfig.json`, `wrangler.jsonc`, plus the collision sibling for `CLAUDE.md`)
**Conflicts (.scaffold siblings)**: CLAUDE.md.scaffold (existing CLAUDE.md preserved)
**.gitignore handling**: append-merged (cwd's Next.js-shaped patterns kept; starter's `dist/`, `.astro/`, `.dev.vars`, `.wrangler/`, `.idea/`, `node_modules/`, `.env`, `.env.production` appended de-duped under a `# from 10x-astro-starter` separator)
**.bootstrap-scaffold cleanup**: deleted (after `.git/` was dropped per git-clone strategy)

Notes:

- pnpm install completed in 19.6s; 736 packages added. Build scripts for `sharp@0.34.5` and `workerd@1.20260518.1` were ignored by pnpm policy — run `pnpm approve-builds` if you want them to execute.
- The starter ships both `package-lock.json` (npm-shaped) and `pnpm-lock.yaml`. The hand-off chose pnpm; downstream commands should target pnpm. Consider deleting `package-lock.json` so only one lockfile is in tree.
- The cwd had pre-existing Next.js-shaped artifacts (`.next/`, `next-env.d.ts`, Next.js `.gitignore` patterns) from a prior partial attempt. None collided with the Astro scaffold output and the conflict policy left them untouched. Manual cleanup recommended once the Astro tree is confirmed working.

## Post-scaffold audit

**Tool**: `npm audit --json`
**Summary**: 0 CRITICAL, 1 HIGH, 10 MODERATE, 0 LOW (total 11 across 895 deps: 449 prod / 316 dev / 131 optional)
**Direct vs transitive**: 0/0/3/0 direct of total 0/1/10/0 (3 direct moderate findings; the HIGH and remaining 7 moderates are transitive)

#### CRITICAL findings

(none)

#### HIGH findings

- **devalue** 5.6.3–5.8.0 — transitive via `@cloudflare/vite-plugin → wrangler → miniflare`. Advisory **GHSA-77vg-94rm-hx3p**: Svelte devalue DoS via sparse array deserialization (CWE-770, CVSS 7.5). Fix path requires bumping the Cloudflare adapter chain (registry suggests `@astrojs/cloudflare@12.6.13` as a semver-major fix; review compatibility before applying).

#### MODERATE findings

Direct (3):

- **@astrojs/check** — direct devDependency; advisory chain via `@astrojs/language-server → volar-service-yaml → yaml-language-server → yaml`. Fix: `@astrojs/check@0.9.2` (semver-major).
- **@astrojs/cloudflare** — direct dependency; advisory chain via `@cloudflare/vite-plugin`, `wrangler`. Fix: `@astrojs/cloudflare@12.6.13` (semver-major).
- **wrangler** — direct devDependency; advisory chain via `miniflare`. Fix: `wrangler@3.107.3` (semver-major).

Transitive (7):

- **@astrojs/language-server** — via volar-service-yaml.
- **@cloudflare/vite-plugin** — via miniflare, wrangler, ws.
- **miniflare** — via ws.
- **volar-service-yaml** — via yaml-language-server.
- **ws** 8.0.0–8.20.0 — advisory **GHSA-58qx-3vcg-4xpx**: uninitialized memory disclosure (CWE-908, CVSS 4.4). Found in `node_modules/@supabase/realtime-js/node_modules/ws` and `node_modules/ws`.
- **yaml** 2.0.0–2.8.2 — advisory **GHSA-48c2-rrv3-qjmp**: stack overflow via deeply nested YAML collections (CWE-674, CVSS 4.3). Found in `node_modules/yaml-language-server/node_modules/yaml`.
- **yaml-language-server** — via yaml.

#### LOW / INFO findings

(none)

## Hints recorded but not acted on

| Hint                    | Value                |
| ----------------------- | -------------------- |
| bootstrapper_confidence | first-class          |
| quality_override        | false                |
| path_taken              | standard             |
| self_check_answers      | null                 |
| team_size               | solo                 |
| deployment_target       | cloudflare-pages     |
| ci_provider             | github-actions       |
| ci_default_flow         | auto-deploy-on-merge |
| has_auth                | true                 |
| has_payments            | false                |
| has_realtime            | false                |
| has_ai                  | false                |
| has_background_jobs     | false                |

## Next steps

Next: a future skill will set up agent context (CLAUDE.md, AGENTS.md). For now, your project is scaffolded and verified — happy hacking.

Useful manual steps in the meantime:

- `git init` (if you have not already) to start your own repo history.
- Review any `.scaffold` siblings the conflict policy created and decide which version of each file to keep — here, `CLAUDE.md.scaffold` (the starter's CLAUDE.md) vs `CLAUDE.md` (your existing lesson notes).
- Decide on a single lockfile: the starter shipped both `package-lock.json` and `pnpm-lock.yaml`; the hand-off chose pnpm, so deleting `package-lock.json` removes ambiguity.
- Clean up pre-existing Next.js artifacts (`.next/`, `next-env.d.ts`) once you've confirmed the Astro tree is what you want.
- Address audit findings per your project's risk tolerance. The HIGH (`devalue`) and the direct MODERATEs (`@astrojs/check`, `@astrojs/cloudflare`, `wrangler`) all resolve via semver-major upgrades in the Cloudflare/Astro chain; review the changelogs before bumping.
- Wire your Supabase project and Cloudflare account — both `wrangler.jsonc` and `supabase/` ship as templates that need your environment values.
