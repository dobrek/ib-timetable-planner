import { describe, expect, it } from "vitest";
import { CONTAINER_WORKERS, solverContainerEnvVars } from "./solver-container-env";

describe("solverContainerEnvVars", () => {
  it("forwards the credential trio the container signs in with", () => {
    expect(
      solverContainerEnvVars({
        SUPABASE_URL: "https://project.supabase.co",
        SUPABASE_KEY: "publishable",
        SOLVER_MACHINE_PASSWORD: "secret",
      }),
    ).toMatchObject({
      SUPABASE_URL: "https://project.supabase.co",
      SUPABASE_KEY: "publishable",
      SOLVER_MACHINE_PASSWORD: "secret",
    });
  });

  it("sets SOLVER_WORKERS explicitly rather than letting the service default to 8", () => {
    // The failure this pins is silence: `settings.py` defaults to 8, and 8 CP-SAT workers
    // timesharing standard-4's 4 vCPU honours the reproducibility pin in name only. Whatever ships
    // here is the fixture S-308 calibrates against.
    expect(solverContainerEnvVars({}).SOLVER_WORKERS).toBe(CONTAINER_WORKERS);
    expect(CONTAINER_WORKERS).toBe("4");
  });

  it("caps the container at one concurrent job and logs at INFO", () => {
    expect(solverContainerEnvVars({})).toMatchObject({
      SOLVER_MAX_CONCURRENT_JOBS: "1",
      SOLVER_LOG_LEVEL: "INFO",
    });
  });

  it("prefers SOLVER_SUPABASE_URL over the Worker's own SUPABASE_URL", () => {
    // Tier 3's whole problem: the Worker reaches the local stack at 127.0.0.1, which inside the
    // container is the container. The two genuinely need different values.
    expect(
      solverContainerEnvVars({
        SUPABASE_URL: "http://127.0.0.1:54321",
        SOLVER_SUPABASE_URL: "http://host.docker.internal:54321",
      }).SUPABASE_URL,
    ).toBe("http://host.docker.internal:54321");
  });

  it("falls back to SUPABASE_URL when no override is set — the production shape", () => {
    expect(solverContainerEnvVars({ SUPABASE_URL: "https://project.supabase.co" }).SUPABASE_URL).toBe(
      "https://project.supabase.co",
    );
  });

  it("emits empty strings, never undefined, for an unconfigured Worker", () => {
    // `envVars` is typed `Record<string, string>`, and an undefined would either throw at the RPC
    // boundary or reach the container as the literal "undefined" — which `settings.configured`
    // would then read as PRESENT, defeating the bare-container promise.
    const vars = solverContainerEnvVars({});
    expect(vars.SUPABASE_URL).toBe("");
    expect(vars.SUPABASE_KEY).toBe("");
    expect(vars.SOLVER_MACHINE_PASSWORD).toBe("");
    expect(Object.values(vars).every((value) => typeof value === "string")).toBe(true);
  });

  it("forwards nothing beyond the six documented keys", () => {
    // A stray key here is a privilege leak into a component that only ever sees UUIDs.
    expect(Object.keys(solverContainerEnvVars({})).sort()).toEqual([
      "SOLVER_LOG_LEVEL",
      "SOLVER_MACHINE_PASSWORD",
      "SOLVER_MAX_CONCURRENT_JOBS",
      "SOLVER_WORKERS",
      "SUPABASE_KEY",
      "SUPABASE_URL",
    ]);
  });
});
