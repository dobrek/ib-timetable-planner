import { describe, expect, it } from "vitest";
import { selectSolverTransport } from "./select-solver-transport";
import type { SolverTransport } from "./solver-transport";

/** Identity is all these need to carry: every assertion below is about WHICH one came back. */
const stubTransport = (): SolverTransport => ({
  dispatchSolveJob: () => Promise.resolve(),
  checkHealth: () => Promise.resolve(true),
});

const urlTransport = stubTransport();
const bindingTransport = stubTransport();

const select = (url: string | undefined, binding: string | undefined) =>
  selectSolverTransport<string>({
    url,
    binding,
    fromUrl: () => urlTransport,
    fromBinding: () => bindingTransport,
  });

describe("selectSolverTransport", () => {
  it("prefers an explicit SOLVER_URL over the container binding", () => {
    // The load-bearing case. If the binding won, the author's `build && preview` loop and the
    // hosted-solve campaign would both need a Docker daemon and a container start for every test.
    expect(select("http://127.0.0.1:8000", "SOLVER")).toBe(urlTransport);
  });

  it("falls back to the binding when no URL is set — the production shape", () => {
    expect(select(undefined, "SOLVER")).toBe(bindingTransport);
  });

  it("returns null when neither is configured", () => {
    // "No solver here" is a supported state the UI renders, not a boot failure: it is what `pnpm
    // build` and the e2e lane run in.
    expect(select(undefined, undefined)).toBeNull();
  });

  it("treats an empty SOLVER_URL as unset rather than as a base URL", () => {
    // An empty string in a `.vars` file is a plausible accident, and `fetch("/jobs/…")` against a
    // relative URL would fail far from the cause.
    expect(select("", "SOLVER")).toBe(bindingTransport);
  });

  it("passes the URL and the binding through to their factories untouched", () => {
    const seen: string[] = [];
    selectSolverTransport<string>({
      url: "http://solver.test",
      binding: "SOLVER",
      fromUrl: (url) => {
        seen.push(url);
        return urlTransport;
      },
      fromBinding: () => bindingTransport,
    });
    expect(seen).toEqual(["http://solver.test"]);
  });
});
