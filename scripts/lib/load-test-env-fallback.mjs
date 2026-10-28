import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Zero-config local DX for the operator scripts: when SUPABASE_URL or the service-role key is not
 * already exported (CI exports them from `supabase status`), fill it from `.env.test.local`, the
 * same file the integration lane's load-test-env.ts reads. A variable already in the environment
 * always wins, so an operator's exported hosted values are never overridden. A missing file is not
 * an error: each caller's absence check reports what is missing.
 */
export function loadTestEnvFallback() {
  try {
    const content = readFileSync(resolve(process.cwd(), ".env.test.local"), "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch {
    // No local test env: the caller's absence check surfaces a clear error.
  }
}
