import type { ActionAPIContext } from "astro:actions";
import { describe, expect, it, vi } from "vitest";
import type { AccessState, Capability } from "@/shared/config";

// The action-level access matrix F-401 deferred to S-403: the capability every composed action
// declares, proven by driving each one's handler as every kind of caller. RLS is the enforcement;
// this pins the guard that turns its silent denials into FORBIDDEN, so a viewer's or role-less
// user's write is refused BEFORE `run` (and before the client even resolves) instead of reading as
// a 0-row success.
//
// `createClient` throws a sentinel, so "the guard let it through" is observable without a database:
// the handler reaches `requireSupabase` only after `requireSession` and `requireCapability` passed.
//
// It walks `server` from the composition root itself, so an action group wired there can never escape
// the matrix. `astro:env/server` is aliased in vitest.config.ts; the solver transport's other source,
// `cloudflare:workers`, exists only inside workerd, so `solver-config` is replaced with a null one.
const { ReachedClient } = vi.hoisted(() => ({ ReachedClient: class ReachedClient extends Error {} }));
vi.mock("@/shared/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/shared/api")>();
  return {
    ...actual,
    createClient: () => {
      throw new ReachedClient("the guard let the call through");
    },
  };
});
vi.mock("@/entities/timetable/api/solver-config", () => ({ getSolverTransport: () => null }));

const { server } = await import("@/actions");
const ACTIONS: Record<string, unknown> = server;

// The only actions that declare less than the `edit` default. Everything else must refuse a viewer.
const NON_EDIT: Record<string, Capability> = {
  updatePassword: "session", // the caller's own account (FR-410)
  updateDisplayName: "session", // the caller's own account (FR-410)
  readGenerationJobStatuses: "read", // the hub's poll
  readPlanJob: "read", // a viewer's plan visit, poll and Refresh; it never writes (S-405)
};

type Outcome = "reached" | "FORBIDDEN" | "SERVICE_UNAVAILABLE";
type AccessLabel = "admin" | "author" | "viewer" | "none" | "unavailable";

const ACCESS: Record<AccessLabel, AccessState> = {
  admin: { status: "granted", role: "admin" },
  author: { status: "granted", role: "author" },
  viewer: { status: "granted", role: "viewer" },
  none: { status: "none" },
  unavailable: { status: "unavailable" },
};

const OUTCOMES: Record<Capability, Record<AccessLabel, Outcome>> = {
  session: { admin: "reached", author: "reached", viewer: "reached", none: "reached", unavailable: "reached" },
  read: {
    admin: "reached",
    author: "reached",
    viewer: "reached",
    none: "FORBIDDEN",
    unavailable: "SERVICE_UNAVAILABLE",
  },
  edit: {
    admin: "reached",
    author: "reached",
    viewer: "FORBIDDEN",
    none: "FORBIDDEN",
    unavailable: "SERVICE_UNAVAILABLE",
  },
};

describe("action capabilities", () => {
  it("declares every non-edit exception on an action that exists", () => {
    expect(Object.keys(ACTIONS)).toEqual(expect.arrayContaining(Object.keys(NON_EDIT)));
  });

  it.each(Object.keys(ACTIONS))("%s", async (name) => {
    const capability = NON_EDIT[name] ?? "edit";
    const outcomes = await probe(ACTIONS[name]);

    expect(outcomes).toEqual(OUTCOMES[capability]);
  });
});

/** Drive the action's handler as every kind of caller, and record how far each call got. */
async function probe(action: unknown): Promise<Record<AccessLabel, Outcome>> {
  const labels = Object.keys(ACCESS) as AccessLabel[];
  const outcomes = await Promise.all(labels.map((label) => outcomeFor(action, ACCESS[label])));
  return Object.fromEntries(labels.map((label, index) => [label, outcomes[index]])) as Record<AccessLabel, Outcome>;
}

async function outcomeFor(action: unknown, access: AccessState): Promise<Outcome> {
  try {
    // The input is never read: every outcome is decided before `run`.
    await handlerOf(action)({}, contextWith(access));
  } catch (error) {
    if (error instanceof ReachedClient) return "reached";
    const code = (error as { code?: unknown }).code;
    if (code === "FORBIDDEN" || code === "SERVICE_UNAVAILABLE") return code;
    throw error;
  }
  throw new Error("the handler returned without resolving a client");
}

// The stub's `defineAction` returns the raw `{ input, handler }` object, but the real astro:actions
// types hide `.handler` on the action client — reach it through a cast matching the stub's shape.
type Handler = (input: unknown, context: ActionAPIContext) => Promise<unknown>;
const handlerOf = (action: unknown): Handler => (action as { handler: Handler }).handler;

// Cast through unknown: the stub's context is a minimal shape, but tsc/eslint see the real one.
const contextWith = (access: AccessState): ActionAPIContext =>
  ({
    locals: { user: { id: "u1" }, access },
    request: new Request("http://localhost/_actions/test", { method: "POST" }),
    cookies: {},
  }) as unknown as ActionAPIContext;
