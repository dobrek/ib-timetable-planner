import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The stack's PUBLISHABLE (anon) key — the only Supabase key the solver container will ever hold.
 *
 * Most of the integration lane needs only the service-role key. The suites that sign in need this
 * one too — the solver-credential guard, and every suite built on `createSignedInUser`: their whole
 * subject is what a client holding *nothing but* the publishable key and a password can reach, and
 * reproducing that with a privileged key would test a different thing entirely. In CI,
 * `load-test-env.ts` fails the run when it is missing.
 *
 * Resolution order — env first (CI exports it from the ephemeral stack), then `.dev.vars` /
 * `.env.local`, which `pnpm env:local` already writes for the dev server. No hardcoded fallback:
 * a wrong key would surface as a confusing 401 rather than as "you have not set this up".
 */
export const readPublishableKey = (): string | undefined =>
  process.env.SUPABASE_KEY ?? fromEnvFile(".dev.vars") ?? fromEnvFile(".env.local");

const fromEnvFile = (name: string): string | undefined => {
  try {
    const content = readFileSync(resolve(process.cwd(), name), "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("SUPABASE_KEY=")) continue;
      return trimmed.slice("SUPABASE_KEY=".length).trim();
    }
  } catch {
    // Missing file is an ordinary case — the caller decides whether that is fatal.
  }
  return undefined;
};
