# `contracts/` — the frozen generation wire contract

`generation-wire.schema.json` is the TS↔Python contract for automatic plan generation, as a
tech-neutral JSON Schema (draft 2020-12) owned by neither side. The TypeScript types
(`src/entities/timetable/model/generation/types.ts`) and the Python dataclasses
(`poc/cp-sat/src/cpsat_engine/schema.py`) are both **projections of this document**, not the other
way round.

This README is normative for everything the schema cannot express: the canonical JSON form, the
versioning policy, and what is deliberately outside the freeze.

Both suites gate it:

| Suite | Test | Runs in |
| --- | --- | --- |
| Vitest | `bench/contract-parity.test.ts` | `pnpm test` → CI `verify` |
| pytest | `poc/cp-sat/tests/test_contract.py` | `uv run pytest` → CI `solver` |

A change on one side that diverges from the artifact turns a suite red. That is the whole point:
before this existed, the two halves were each internally consistent and disagreed in eight places.

## Scope — what is frozen

Every `$defs` entry in `generation-wire.schema.json`:

- `GeneratorSnapshot`, `GeneratorCohortSnapshot`, `WireCourse`, `Pin`, `AvailabilityCell` — the solve
  input. `GeneratorSnapshot` is by definition the engine's complete argument, which is why
  `generation_jobs.snapshot_hash` digests exactly this object.
- `GenerationResult`, `GenerationDiagnostics`, `GenerationCohortDiagnostics`, `GeneratedPlacement`,
  `CourseDeficit` — the solve output.
- `StageReport` — one rung of the lexicographic ladder. **In contract** because S-303 persists an
  array of these into `generation_jobs.stages` and the progress UI reads them. Variable-length and
  possibly sparse (`solve_repair` emits tiers 1 and 4 only) — never a fixed 10-tuple.
- `SolveRequest` — the envelope F-302's `POST /solve` will accept, and the **only** carrier of
  `formatVersion`.
- `Cohort`, `WeekMode`, `PlacementWeek`, `AvailabilitySeverity` — leaf vocabularies, mirroring the
  Postgres enums that single-source them in `src/shared/config/`.

Three decisions the schema encodes that are easy to miss when reading it quickly:

1. **Strict and narrow.** Every object is `additionalProperties: false`. The wire pin is
   `{courseId, day, period, week}` — `id`, `isOptional` and `bundleId` never cross. Since `WireCourse`
   simply has no name/level/colour property, the "the solver sees UUIDs only" posture stops being a
   convention upheld by a projection function and becomes a property the schema enforces.
2. **CP-SAT is the sole wire producer.** `engine` is `const "cp-sat"`; `provenOptimal` is required;
   `partial` means exactly `not provenOptimal`; `stopReason` is `budget | cancelled`. `stagnation` is
   absent because it is a greedy-only reason — **greedy is out of contract entirely** and leaves in
   S-309. The in-app TS types stay wider until then; the wire is the narrow one.
3. **Omit when absent, never null.** No property on this wire may be `null`. An absent optional
   (`lowerBound`, `stopReason`, `best`, `bound`, `warmStart`) is an omitted key. Both canonicalizers
   implement the rule rather than merely documenting it: they drop `null`/`undefined`-valued keys.

## Out of scope — stated so it is never "discovered" and frozen by mistake

- **The bench export dump** (`bench/export-snapshot.experiment.ts` → `poc/cp-sat/tests/fixtures/seed-plan-a.json`).
  Its `meta`, its `greedy.*` warm-start, and its `objective` 10-tuple are **bench transport**, not
  production wire. The dump keeps its own `formatVersion` gate in `schema.py`; that gate is bench
  scope and is unrelated to `SolveRequest.formatVersion`.
- **The `.report.json` sidecar** written by `cli.py` (snake_case `wall_clock_s`, `rows_freed`, config
  echo). `cli.py` is the acknowledged throwaway transport; F-302's HTTP wrapper will not produce it.
- **The greedy engine.** It never crosses the wire and is slated for removal (S-309).
- **The 10-tuple objective.** It is a bench parity baseline; the solver never holds it during the
  ladder (per-stage `best`/`bound` are upper bounds under `tier_k <= best_k` hardening, and
  recovering a true tuple needs an `evaluate_board` re-solve).

## Canonical JSON form

Two consumers need one ordering decision: golden fixtures are **byte-compared**, and
`generation_jobs.snapshot_hash` is a SHA-256 over the same bytes. So "canonical" here is a
specification, not a formatting preference.

A canonical payload is:

1. **UTF-8, compact.** No whitespace anywhere: `{"a":1,"b":[2,3]}`. No trailing newline — the file
   contains exactly the serializer's output.
2. **Keys sorted** lexicographically at every depth. Keys are ASCII in this contract, so JS
   code-unit order and Python code-point order coincide; a non-ASCII key would need this restated
   before it could be added.
3. **Raw UTF-8, never `\uXXXX` escapes.** `JSON.stringify` emits a non-ASCII character literally;
   Python's `json.dumps` escapes it unless told otherwise, so the Python side must pass
   `ensure_ascii=False`. Today every string on this wire is a UUID, so nothing exercises the rule —
   which is exactly why it is written down: the schema constrains `courseId`/`teacherKey`/
   `studentKey` to `string`, so the first non-ASCII key would silently split `snapshot_hash` between
   the two languages. Both suites pin it.
4. **`null`/`undefined`-valued keys omitted** (see decision 3 above).
5. **Every semantically-unordered array sorted by a declared key:**

   | Array | Order |
   | --- | --- |
   | `courses` | by `id` |
   | `teacherKeys`, `studentKeys`, `finishesEarlyByCourseId` | lexicographic |
   | `parkedCourseIds` | lexicographic — a **multiset**: duplicates are semantic (one entry = one parked hour) and must never be deduped |
   | `pins` | by (`courseId`, `day`, `period`, `week`) |
   | `availability` | by (`teacherKey`, `day`, `period`) |
   | `placements` | by (`cohort`, `courseId`, `day`, `period`, `week`) |
   | `unplaced` | by `courseId` |

   `stages` is **not** in this table: it is a ladder transcript, so its order is chronological and
   load-bearing.

6. **Numbers.** Every byte-compared or hash-digested payload (both goldens, the `snapshot_hash`
   input) contains **integers only**. `StageReport.wallClockS` is the sole non-integer in the whole
   contract: it is schema-validated but carries **no cross-language canonical-byte guarantee**
   (Python renders `2.0` as `"2.0"`, JavaScript as `"2"`), so a `StageReport` must never enter a
   byte-compared or hashed payload. Introducing any new float into such a payload is a
   `formatVersion` decision, not an implementation detail. Non-finite numbers are not JSON at all:
   `JSON.stringify(NaN)` writes `null` while Python's `json.dumps` writes a bare `NaN` token, so the
   Python canonicalizer passes `allow_nan=False` and raises rather than emitting bytes no JSON parser
   will read back.

The two implementations:

- TypeScript — `src/entities/timetable/model/generation/wire.ts`
  (`canonicalStringify`, `canonicalizeSnapshot`, `canonicalizeResult`, `computeSnapshotHash`).
- Python — `poc/cp-sat/src/cpsat_engine/wire.py`
  (`canonical_json`, `canonical_snapshot_json`, `canonical_result_json`, `wire_stage_report`), which
  is `json.dumps(..., sort_keys=True, separators=(",", ":"))` plus the same array sorts and
  `None`-key dropping.

Note the split of responsibility on each side: `canonicalStringify` / `canonical_json` serialize an
already-wire-shaped payload and never reorder arrays; the declared sorts live in
`canonicalizeSnapshot` / `canonical_snapshot_json` and `canonicalizeResult` /
`canonical_result_json`. Byte-comparing or hashing a payload that skipped those entry points is a
bug, not a shortcut.

## Versioning

`formatVersion` lives on `SolveRequest` and nowhere else — the snapshot and the result are versioned
**by the envelope that carries them**, never field-by-field. It is `const 1` today.

Bump it when any `$defs` change is breaking for an existing peer: a removed or renamed property, a
narrowed enum, a widened `required` list, a type change, or a new float in a byte-compared payload.
Additive-and-optional changes (a new optional property, a widened enum on a value the peer already
tolerates) do not bump it.

A schema change is always **bilateral**: regenerate both goldens, and both suites must go green in
the same commit. Never update one side's fixture alone — a golden that only one suite agrees with is
worse than no golden.

## Fixtures

`fixtures/generator-snapshot.json` and `fixtures/generation-result.json` are real-size goldens in
canonical bytes, derived from the committed seed dump (5 days × 10 periods, 39 + 42 courses, 238
placements).

**Fixture rule: UUIDs only, no names.** Same posture `.gitignore:84-93` pins for the dump itself —
golden data is production-derived and display text must never be committable. `contract-parity.test.ts`
asserts it.

`contracts/` is in `.prettierignore` **deliberately**: lefthook runs `prettier --write` on staged
`.json` with `stage_fixed: true`, which would re-indent these files on every commit and silently break
the byte comparison (`pnpm format` is not a CI step, so nothing would catch it). The parity test's
byte assertion is the permanent tripwire if that protection is ever removed.

### Regeneration

Only needed for a `formatVersion` bump or a deliberate canonical-form change.

```bash
# 1. One CP-SAT run over the committed seed dump (from poc/cp-sat/).
#    --workers 1 --seed 1 keeps the search deterministic; ~90 s at a 10 s stage budget.
cd poc/cp-sat
uv run cpsat --input tests/fixtures/seed-plan-a.json --output /tmp/cpsat-result.json \
  --mode full --stage-budget 10 --workers 1 --seed 1

# 2. Rewrite both fixtures through the TS canonicalizer (from the repo root).
cd -
RESULT=/tmp/cpsat-result.json pnpm experiment:goldens

# 3. Both gates, same commit.
pnpm test
cd poc/cp-sat && uv run pytest
```

The result golden is a **recorded** artifact, not a reproducible one: CP-SAT's search is
non-deterministic across worker counts and `elapsedMs` is wall-clock, so a regeneration yields a
different — equally legal — board. What the goldens pin is the *form*, not the solution.
