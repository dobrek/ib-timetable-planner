import { afterEach, describe, expect, it, vi } from "vitest";
import { analyzerEnv } from "./analyzer-client.ts";
import { childEnv, run } from "./process-lifetime.ts";

/**
 * The runner holds production credentials and starts children — wrangler, git, pnpm, the local solver.
 * None of them needs those credentials, so none inherits them; the analyzer is handed its key renamed.
 */
afterEach(() => {
  vi.unstubAllEnvs();
});

const stubSecrets = (): void => {
  vi.stubEnv("ANALYZER_SERVICE_ROLE_KEY", "service-role");
  vi.stubEnv("CAMPAIGN_PASSWORD", "author-password");
  vi.stubEnv("CLOUDFLARE_OBSERVABILITY_TOKEN", "observability-token");
  vi.stubEnv("LOCAL_SOLVER_MACHINE_PASSWORD", "machine-password");
};

describe("a child's environment", () => {
  it("never carries the runner's credentials, but keeps everything else", () => {
    stubSecrets();
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "account");

    const env = childEnv();

    expect(env).not.toHaveProperty("ANALYZER_SERVICE_ROLE_KEY");
    expect(env).not.toHaveProperty("CAMPAIGN_PASSWORD");
    expect(env).not.toHaveProperty("CLOUDFLARE_OBSERVABILITY_TOKEN");
    expect(env).not.toHaveProperty("LOCAL_SOLVER_MACHINE_PASSWORD");
    expect(env.CLOUDFLARE_ACCOUNT_ID).toBe("account");
  });

  it("is what a spawned command actually sees", async () => {
    stubSecrets();

    const seen = await run("sh", ["-c", 'printf "%s" "${CAMPAIGN_PASSWORD:-absent}"']);

    expect(seen).toBe("absent");
  });

  it("hands the analyzer its key under the name it reads, and nothing else secret", () => {
    stubSecrets();

    const env = analyzerEnv({
      supabaseUrl: "http://127.0.0.1:54321",
      serviceRoleKey: "service-role",
      allowRemote: false,
    });

    expect(env.SUPABASE_SERVICE_ROLE_KEY).toBe("service-role");
    expect(Object.values(env)).not.toContain("author-password");
    expect(Object.values(env)).not.toContain("observability-token");
    expect(env).not.toHaveProperty("ANALYZER_SERVICE_ROLE_KEY");
  });

  it("turns the analyzer's colour off, because a program reads its output", () => {
    vi.stubEnv("TERM", "xterm-256color");

    const env = analyzerEnv({ supabaseUrl: "http://127.0.0.1:54321", serviceRoleKey: "key", allowRemote: false });

    expect(env.NO_COLOR).toBe("1");
  });
});
