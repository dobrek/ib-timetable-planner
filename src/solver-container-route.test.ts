import { describe, expect, it, vi, type Mock } from "vitest";
import type { SolverContainerStatus, StopIfIdleResult } from "./solver-container-ops";
import {
  handleSolverContainerRoute,
  type SolverContainerRouteDeps,
  type SolverContainerRouteRequest,
} from "./solver-container-route";

const STATUS: SolverContainerStatus = {
  running: true,
  state: "healthy",
  lastChange: 1_727_000_000_000,
  effectiveTuning: { workers: 4, stageBudgetS: 120, modeABudgetS: 300, stageTargets: "", overridden: [] },
  sleepAfter: "30m",
};

type ControlDouble = {
  readonly status: Mock<() => Promise<SolverContainerStatus>>;
  readonly stopIfIdle: Mock<() => Promise<StopIfIdleResult>>;
};

const control = (): ControlDouble => ({
  status: vi.fn(() => Promise.resolve(STATUS)),
  stopIfIdle: vi.fn(() => Promise.resolve({ outcome: "busy" as const })),
});

const deps = (overrides: Partial<SolverContainerRouteDeps> = {}): SolverContainerRouteDeps => ({
  email: "ops@example.test",
  allowlist: "ops@example.test",
  control: control(),
  ...overrides,
});

const get: SolverContainerRouteRequest = { method: "GET", contentType: null, body: undefined };
const stop: SolverContainerRouteRequest = {
  method: "POST",
  contentType: "application/json",
  body: { action: "stop-if-idle" },
};

describe("handleSolverContainerRoute", () => {
  it("answers 404 to a signed-in account when the allowlist is unset or empty", async () => {
    for (const allowlist of [undefined, "", " , "]) {
      const ops = control();
      const response = await handleSolverContainerRoute(get, deps({ allowlist, control: ops }));
      expect(response.status, String(allowlist)).toBe(404);
      expect(ops.status).not.toHaveBeenCalled();
    }
  });

  it("refuses (403) a signed-in account outside the allowlist", async () => {
    const ops = control();
    const response = await handleSolverContainerRoute(stop, deps({ email: "author@example.test", control: ops }));
    expect(response.status).toBe(403);
    expect(ops.stopIfIdle).not.toHaveBeenCalled();
  });

  it("answers 409 when the Worker has no container binding", async () => {
    expect((await handleSolverContainerRoute(get, deps({ control: null }))).status).toBe(409);
  });

  it("answers GET with the container's status", async () => {
    const response = await handleSolverContainerRoute(get, deps());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(STATUS);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("answers the stop action with the stop decision's outcome", async () => {
    const ops = control();
    const response = await handleSolverContainerRoute(stop, deps({ control: ops }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ outcome: "busy" });
    expect(ops.stopIfIdle).toHaveBeenCalledOnce();
  });

  it("accepts a JSON content type that carries a charset", async () => {
    const response = await handleSolverContainerRoute(
      { ...stop, contentType: "application/json; charset=utf-8" },
      deps(),
    );
    expect(response.status).toBe(200);
  });

  it("refuses any other POST body without touching the container", async () => {
    for (const body of [undefined, {}, { action: "stop" }, "stop-if-idle", null]) {
      const ops = control();
      const response = await handleSolverContainerRoute({ ...stop, body }, deps({ control: ops }));
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(ops.stopIfIdle).not.toHaveBeenCalled();
    }
  });

  it("answers 503 as JSON when the container call itself fails", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    for (const request of [get, stop]) {
      const ops = control();
      ops.status.mockRejectedValue(new Error("Durable Object reset"));
      ops.stopIfIdle.mockRejectedValue(new Error("Durable Object reset"));
      const response = await handleSolverContainerRoute(request, deps({ control: ops }));
      expect(response.status, request.method).toBe(503);
      expect(await response.json()).toMatchObject({ retryable: true });
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    quiet.mockRestore();
  });

  it("refuses a stop that is not sent as JSON (415) — a cross-site form cannot reach it", async () => {
    const ops = control();
    const response = await handleSolverContainerRoute({ ...stop, contentType: "text/plain" }, deps({ control: ops }));
    expect(response.status).toBe(415);
    expect(ops.stopIfIdle).not.toHaveBeenCalled();
  });
});
