import { describe, expect, it } from "vitest";

// Invariant guard (runs in the unit lane): integration suites must own their data
// via the factory (createPlan + seedPlanCatalog + teardown), never read the shared
// dev seed by name. A reintroduced `Seed Plan A`/`Seed Plan B` lookup fails here,
// locking the plan-rooted isolation that makes the integration lane parallel-safe
// and resilient to a dev-DB exchange. See test-plan.md §6.2.
const SEED_NAME_RE = /Seed Plan [AB]/;

// Raw contents of every integration suite, keyed by path. This file is a plain
// `.test.ts` (not `.integration.test.ts`), so the glob never scans itself — the
// `SEED_NAME_RE` literal above can't self-trigger.
const files: Record<string, string> = import.meta.glob("../**/*.integration.test.ts", {
  query: "?raw",
  import: "default",
  eager: true,
});

describe("no seed-name coupling in integration suites", () => {
  it("finds integration suites to scan", () => {
    expect(Object.keys(files).length).toBeGreaterThan(0);
  });

  it("no *.integration.test.ts references 'Seed Plan A'/'Seed Plan B'", () => {
    const offenders = Object.entries(files)
      .filter(([, content]) => SEED_NAME_RE.test(content))
      .map(([path]) => path)
      .sort();
    expect(offenders).toEqual([]);
  });
});
