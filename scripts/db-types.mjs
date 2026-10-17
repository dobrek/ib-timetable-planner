#!/usr/bin/env node
// Regenerates src/shared/api/database.types.ts from the LOCAL Supabase stack, fail-safe.
//
// The raw `supabase gen types typescript --local > database.types.ts` redirect truncates the file
// before the command runs, so a stopped stack or a CLI error leaves an empty file behind (HC Fix 8).
// This writes beside the target and renames into place only when the generator exits 0 with
// output that looks like the types module; on any failure the committed file is left untouched.
//
// Host tooling (Node on the dev machine), like the other scripts/*.mjs — not Worker code.
import { spawnSync } from "node:child_process";
import { renameSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const target = resolve(import.meta.dirname, "../src/shared/api/database.types.ts");
const staging = `${target}.tmp`;

const result = spawnSync("pnpm", ["exec", "supabase", "gen", "types", "typescript", "--local"], {
  encoding: "utf-8",
  stdio: ["ignore", "pipe", "inherit"],
});

if (result.error) fail(`could not run the generator: ${result.error.message}`);
if (result.status !== 0) fail(`the generator exited with status ${result.status}`);
if (!result.stdout.includes("export type Database")) fail("the generator's output is not a Database types module");

try {
  writeFileSync(staging, result.stdout);
  renameSync(staging, target);
} catch (error) {
  rmSync(staging, { force: true });
  fail(`could not write ${target}: ${error instanceof Error ? error.message : String(error)}`);
}
process.stdout.write(`[db-types] wrote ${target}\n`);

function fail(reason) {
  process.stderr.write(`[db-types] ${reason}; database.types.ts left unchanged.\n`);
  process.exit(1);
}
