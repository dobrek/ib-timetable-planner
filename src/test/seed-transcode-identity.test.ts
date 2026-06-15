import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Structural-identity guard (runs in the unit lane): regenerating the seed must
// reproduce the committed supabase/seed.sql exactly, modulo the random UUIDs each
// run mints. This is the *automated* form of the plan's "byte-identical seed"
// check — it single-sources the composite-FK remap shared by gen-seed.mjs and the
// test factory's seedPlanCatalog, so a future divergence between those two
// consumers (or a broken randomUUID() call order) fails here instead of shipping
// uncaught. A literal `diff` can never be empty because every row carries a fresh
// UUID; we mask UUIDs on both sides and compare the remaining structure.
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const maskUuids = (sql: string) => sql.replace(UUID_RE, "<uuid>");

describe("seed transcode identity", () => {
  it("regenerated seed is structurally identical to supabase/seed.sql (UUIDs masked)", () => {
    const root = process.cwd();
    const regenerated = execFileSync("node", ["scripts/gen-seed.mjs"], {
      cwd: root,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const committed = readFileSync(resolve(root, "supabase/seed.sql"), "utf-8");

    expect(maskUuids(regenerated)).toEqual(maskUuids(committed));
  });
});
