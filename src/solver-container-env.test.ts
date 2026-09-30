import { describe, expect, it } from "vitest";
import {
  CONTAINER_MODE_A_BUDGET_S,
  CONTAINER_STAGE_BUDGET_S,
  CONTAINER_STAGE_TARGETS,
  CONTAINER_WORKERS,
  effectiveTuning,
  isValidCalibrationValue,
  solverContainerEnvVars,
} from "./solver-container-env";

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

  it("sends the ladder's time allowances explicitly rather than letting the engine default win", () => {
    // Not because the numbers differ from the engine's — today they do not — but because the
    // container's startup line can only prove which cell a calibration run used if the Worker
    // actually sent the values. An absent key logs `<engine-default>`, which is a fine default and
    // a useless record.
    expect(solverContainerEnvVars({})).toMatchObject({
      SOLVER_STAGE_BUDGET_S: CONTAINER_STAGE_BUDGET_S,
      SOLVER_MODE_A_BUDGET_S: CONTAINER_MODE_A_BUDGET_S,
    });
    expect(CONTAINER_STAGE_BUDGET_S).toBe("120");
    expect(CONTAINER_MODE_A_BUDGET_S).toBe("300");
  });

  it("forwards the stage-target key empty — the machinery, without a catalog-specific value", () => {
    // A target is an objective value, so it belongs to a catalog and a season, not to a deployment
    // constant. Forwarding it empty is exactly today's behaviour (`settings.py` reads "" as no
    // targets, with no complaint) while making a future season's tuning a one-line diff.
    expect(solverContainerEnvVars({}).SOLVER_STAGE_TARGETS).toBe("");
    expect(CONTAINER_STAGE_TARGETS).toBe("");
  });

  it("forwards nothing beyond the nine documented keys", () => {
    // A stray key here is a privilege leak into a component that only ever sees UUIDs. The three
    // S-308 added are tuning values — a duration, a duration, and an objective bound — so they
    // widen what the container can be TOLD, never what it can reach.
    expect(Object.keys(solverContainerEnvVars({})).sort()).toEqual([
      "SOLVER_LOG_LEVEL",
      "SOLVER_MACHINE_PASSWORD",
      "SOLVER_MAX_CONCURRENT_JOBS",
      "SOLVER_MODE_A_BUDGET_S",
      "SOLVER_STAGE_BUDGET_S",
      "SOLVER_STAGE_TARGETS",
      "SOLVER_WORKERS",
      "SUPABASE_KEY",
      "SUPABASE_URL",
    ]);
  });
});

describe("calibration overrides", () => {
  it("lets each CALIBRATION_* secret replace its pinned constant", () => {
    const vars = solverContainerEnvVars({
      CALIBRATION_WORKERS: "8",
      CALIBRATION_STAGE_BUDGET_S: "240",
      CALIBRATION_MODE_A_BUDGET_S: "600",
    });
    expect(vars).toMatchObject({
      SOLVER_WORKERS: "8",
      SOLVER_STAGE_BUDGET_S: "240",
      SOLVER_MODE_A_BUDGET_S: "600",
    });
  });

  it("reports which keys an override set, and only those", () => {
    expect(effectiveTuning({ CALIBRATION_STAGE_BUDGET_S: "60" })).toEqual({
      workers: 4,
      stageBudgetS: 60,
      modeABudgetS: 300,
      stageTargets: "",
      overridden: ["CALIBRATION_STAGE_BUDGET_S"],
    });
    expect(effectiveTuning({}).overridden).toEqual([]);
  });

  it("reads an empty or whitespace secret as unset, not as an override", () => {
    // `wrangler secret bulk` cannot store "no value", so a parked key may linger as "".
    const tuning = effectiveTuning({ CALIBRATION_WORKERS: "", CALIBRATION_STAGE_BUDGET_S: "  " });
    expect(tuning.workers).toBe(Number(CONTAINER_WORKERS));
    expect(tuning.stageBudgetS).toBe(Number(CONTAINER_STAGE_BUDGET_S));
    expect(tuning.overridden).toEqual([]);
  });

  it("falls back to the constant on a malformed value", () => {
    for (const raw of ["abc", "120s", "-60", "1e2", "0x10", "Infinity", "NaN"]) {
      const tuning = effectiveTuning({ CALIBRATION_STAGE_BUDGET_S: raw });
      expect(tuning.stageBudgetS, raw).toBe(Number(CONTAINER_STAGE_BUDGET_S));
      expect(tuning.overridden, raw).toEqual([]);
    }
  });

  it("falls back to the constant on an out-of-range value", () => {
    expect(effectiveTuning({ CALIBRATION_WORKERS: "0" }).workers).toBe(Number(CONTAINER_WORKERS));
    expect(effectiveTuning({ CALIBRATION_WORKERS: "17" }).workers).toBe(Number(CONTAINER_WORKERS));
    expect(effectiveTuning({ CALIBRATION_STAGE_BUDGET_S: "0" }).stageBudgetS).toBe(Number(CONTAINER_STAGE_BUDGET_S));
    expect(effectiveTuning({ CALIBRATION_STAGE_BUDGET_S: "1801" }).stageBudgetS).toBe(Number(CONTAINER_STAGE_BUDGET_S));
    expect(effectiveTuning({ CALIBRATION_MODE_A_BUDGET_S: "3601" }).modeABudgetS).toBe(
      Number(CONTAINER_MODE_A_BUDGET_S),
    );
  });

  it("requires a whole number of workers but accepts a fractional budget", () => {
    expect(effectiveTuning({ CALIBRATION_WORKERS: "4.5" }).overridden).toEqual([]);
    expect(effectiveTuning({ CALIBRATION_STAGE_BUDGET_S: "7.5" }).stageBudgetS).toBe(7.5);
  });

  it("trims a well-formed value rather than refusing it", () => {
    expect(effectiveTuning({ CALIBRATION_WORKERS: " 8 " }).workers).toBe(8);
  });

  it("never overrides the stage targets — a campaign measures budgets, not bounds", () => {
    const vars = solverContainerEnvVars({ CALIBRATION_STAGE_BUDGET_S: "60" });
    expect(vars.SOLVER_STAGE_TARGETS).toBe(CONTAINER_STAGE_TARGETS);
  });

  it("changes values, never keys — the nine-key set holds under a full override", () => {
    const vars = solverContainerEnvVars({
      CALIBRATION_WORKERS: "8",
      CALIBRATION_STAGE_BUDGET_S: "60",
      CALIBRATION_MODE_A_BUDGET_S: "300",
    });
    expect(Object.keys(vars).sort()).toEqual(Object.keys(solverContainerEnvVars({})).sort());
  });
});

describe("isValidCalibrationValue", () => {
  it("applies the same bounds the Worker applies", () => {
    expect(isValidCalibrationValue("CALIBRATION_WORKERS", 8)).toBe(true);
    expect(isValidCalibrationValue("CALIBRATION_WORKERS", 8.5)).toBe(false);
    expect(isValidCalibrationValue("CALIBRATION_STAGE_BUDGET_S", 5)).toBe(true);
    expect(isValidCalibrationValue("CALIBRATION_STAGE_BUDGET_S", 0)).toBe(false);
    expect(isValidCalibrationValue("CALIBRATION_MODE_A_BUDGET_S", Number.NaN)).toBe(false);
  });
});
