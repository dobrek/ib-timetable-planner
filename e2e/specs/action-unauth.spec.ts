import { test, expect } from "@playwright/test";

// Runs in the `chromium-guard` project (no session cookies). This is the SECOND
// auth layer and the exact truth the middleware's `/_` exemption makes non-obvious:
// Astro Actions POST to `/_actions/*`, which is exempt from the page redirect, so
// each handler must enforce the session itself via `requireSession`. A no-cookie
// POST is therefore rejected server-side with UNAUTHORIZED — a true boundary test
// (real server rejection), not a mocked route.
//
// The body is SCHEMA-VALID `{ name, slotGridPreset }` on purpose: Zod input
// validation fires before the handler body, so a malformed body would surface an
// input error instead of UNAUTHORIZED. Valid input lets `requireSession` be what
// rejects. The request never reaches the insert, so it leaves no residue.
test("createPlan with no session is refused with UNAUTHORIZED over HTTP", async ({ request }) => {
  const response = await request.post("/_actions/createPlan", {
    data: { name: "e2e-unauth-probe", slotGridPreset: "5x10" },
  });

  // UNAUTHORIZED maps to HTTP 401; the action-error body carries the code 1:1.
  expect(response.status()).toBe(401);
  const body = (await response.json()) as { code?: string };
  expect(body.code).toBe("UNAUTHORIZED");
});
