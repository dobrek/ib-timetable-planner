import { describe, expect, it } from "vitest";
import { isLoopbackHost } from "./loopback-host";

describe("isLoopbackHost", () => {
  it.each(["localhost", "127.0.0.1", "[::1]"])("accepts %s", (host) => {
    expect(isLoopbackHost(host)).toBe(true);
  });

  it("accepts each as URL.hostname spells it", () => {
    for (const url of ["http://localhost:4321", "http://127.0.0.1:54324", "http://[::1]:8000"]) {
      expect(isLoopbackHost(new URL(url).hostname), url).toBe(true);
    }
  });

  it.each(["ib-timetable-planner.dev", "127.0.0.2", "::1", "localhost.example.test", "0.0.0.0", ""])(
    "refuses %s",
    (host) => {
      expect(isLoopbackHost(host)).toBe(false);
    },
  );
});
