import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The runner executes under Node's type stripping, not vitest: an `@/` import, an extensionless
 * relative import or a value import of a type-only module anywhere in its graph passes every other
 * test here and breaks every command. `status` imports the whole graph, needs no network and no
 * credentials, so running it through bare `node` is the check — criterion 4.7, kept in CI.
 */
describe("main.ts under bare Node", () => {
  it("loads every runner module and prints the status of a fresh journal", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "campaign-bare-node-"));
    try {
      const result = spawnSync(process.execPath, ["bench/campaign/main.ts", "status"], {
        env: { ...process.env, CAMPAIGN_TARGET: "local", CAMPAIGN_STATE_DIR: stateDir },
        encoding: "utf8",
        timeout: 30_000,
      });

      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(/^target +local \(not set up/m);
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
  });
});
