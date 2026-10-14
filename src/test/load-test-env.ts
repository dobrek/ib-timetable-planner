import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Loads .env.test.local (gitignored) into process.env for integration tests.
// Vitest does not auto-populate process.env from non-VITE_ env files, so we parse
// the file explicitly. Absent file → integration tests skip via their own guard.
const envPath = resolve(process.cwd(), ".env.test.local");

try {
  const content = readFileSync(envPath, "utf-8");
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
  // No local test env — integration tests guard on the missing vars and skip.
}

// In CI the stack is always expected, so a missing var means the stack failed to
// boot or export its env — fail the whole run loudly instead of letting suites
// silently skip (the silent-zero-coverage trap). Locally (CI unset) we keep the
// per-suite describe.skip so a dev without the stack stays unblocked.
//
// SUPABASE_KEY (the publishable key) is on the list because the suites that sign in — the
// solver-credential guard and the role matrix — would otherwise skip in CI without a sound.
if (process.env.CI === "true") {
  const missing = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_KEY"].filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(
      `Integration tests expected the Supabase stack in CI but these vars are missing: ${missing.join(", ")}. ` +
        `The supabase-stack action's "Assert Supabase env" step should have failed the job first — ` +
        `check that it ran.`,
    );
  }
}
