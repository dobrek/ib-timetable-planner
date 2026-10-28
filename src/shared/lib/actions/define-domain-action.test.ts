import { ActionError, type ActionAPIContext } from "astro:actions";
import { z } from "zod";
import { describe, expect, it, vi } from "vitest";
import type { AccessState } from "@/shared/config";
import { DomainError } from "@/shared/lib/errors";

// The wrapper's only DB dependency is `createClient` (module-imported from
// @/shared/api, not injectable), so we mock it with a controllable return: tests
// flip `mockState.client` between null (unconfigured) and a fake client. The
// `astro:actions` virtual module is resolved by the vitest.config alias/stub, not vi.mock.
const { mockState } = vi.hoisted((): { mockState: { client: unknown } } => ({ mockState: { client: null } }));
vi.mock("@/shared/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/shared/api")>();
  return { ...actual, createClient: () => mockState.client };
});

const { INSUFFICIENT_PRIVILEGE, unwrapRow } = await import("@/shared/api");
const { defineDomainAction } = await import("./define-domain-action");
const { requireSession } = await import("./require-session");
const { requireSupabase } = await import("./require-supabase");
const { runDomain } = await import("./run-domain");

const AUTHOR: AccessState = { status: "granted", role: "author" };
const VIEWER: AccessState = { status: "granted", role: "viewer" };
const NONE: AccessState = { status: "none" };

// Cast through unknown: the stub types `locals.user` as `unknown`, but tsc/eslint see
// the real astro:actions `ActionAPIContext` whose `locals.user` is `User | null`. An author
// unless a test says otherwise, so the capability guard passes where it is not the subject.
const makeContext = (user: unknown, access: AccessState = AUTHOR): ActionAPIContext =>
  ({
    locals: { user, access },
    request: new Request("http://localhost/_actions/test", { method: "POST" }),
    cookies: {},
  }) as unknown as ActionAPIContext;

// Capture a thrown error whether the fn throws synchronously or rejects async.
const grab = async (fn: () => unknown): Promise<unknown> => {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  throw new Error("expected the function to throw");
};

// The vitest stub's `defineAction` returns the raw `{ input, handler }` object, but the
// real astro:actions types (used by tsc/eslint) hide `.handler` on the action client —
// so reach the handler through a cast that matches the stub's runtime shape.
type DomainHandler<I, O> = (input: I, context: ActionAPIContext) => Promise<O>;
const handlerOf = <I, O>(action: unknown): DomainHandler<I, O> => (action as { handler: DomainHandler<I, O> }).handler;

describe("requireSession", () => {
  it("throws UNAUTHORIZED when locals has no user", async () => {
    const error = await grab(() => {
      requireSession(makeContext(undefined));
    });
    expect(error).toBeInstanceOf(ActionError);
    expect((error as ActionError).code).toBe("UNAUTHORIZED");
  });

  it("returns (no throw) when a user is present", () => {
    expect(() => {
      requireSession(makeContext({ id: "u1" }));
    }).not.toThrow();
  });
});

describe("runDomain", () => {
  it("translates a DomainError to an ActionError with the same code + message", async () => {
    const error = (await grab(() =>
      runDomain(() => Promise.reject(new DomainError("NOT_FOUND", "missing"))),
    )) as ActionError;
    expect(error).toBeInstanceOf(ActionError);
    expect(error.code).toBe("NOT_FOUND");
    expect(error.message).toBe("missing");
  });

  it("propagates a non-DomainError throw unchanged", async () => {
    const boom = new TypeError("boom");
    const error = await grab(() => runDomain(() => Promise.reject(boom)));
    expect(error).toBe(boom);
  });

  it("returns the value on success", async () => {
    await expect(runDomain(() => Promise.resolve(42))).resolves.toBe(42);
  });
});

describe("requireSupabase", () => {
  it("throws INTERNAL_SERVER_ERROR when createClient returns null", async () => {
    mockState.client = null;
    const error = await grab(() => requireSupabase(makeContext({ id: "u1" })));
    expect(error).toBeInstanceOf(ActionError);
    expect((error as ActionError).code).toBe("INTERNAL_SERVER_ERROR");
  });

  it("returns the client when createClient resolves one", () => {
    const fake = { tag: "client" };
    mockState.client = fake;
    expect(requireSupabase(makeContext({ id: "u1" }))).toBe(fake);
  });
});

describe("defineDomainAction", () => {
  it("passes (supabase, input) to run and returns its value", async () => {
    const fake = { tag: "client" };
    mockState.client = fake;
    let received: { supabase: unknown; input: unknown } | undefined;

    const action = defineDomainAction({
      input: z.object({ n: z.number() }),
      run: (supabase, input) => {
        received = { supabase, input };
        return Promise.resolve(input.n * 2);
      },
    });

    const result = await handlerOf<{ n: number }, number>(action)({ n: 21 }, makeContext({ id: "u1" }));
    expect(result).toBe(42);
    expect(received?.supabase).toBe(fake);
    expect(received?.input).toEqual({ n: 21 });
  });

  it("surfaces a DomainError thrown by run as the translated ActionError", async () => {
    mockState.client = { tag: "client" };
    const action = defineDomainAction({
      input: z.object({}),
      run: () => Promise.reject(new DomainError("CONFLICT", "dup")),
    });

    const error = await grab(() => handlerOf<Record<string, never>, never>(action)({}, makeContext({ id: "u1" })));
    expect(error).toBeInstanceOf(ActionError);
    expect((error as ActionError).code).toBe("CONFLICT");
  });

  it("enforces the session before resolving the client", async () => {
    mockState.client = { tag: "client" };
    const action = defineDomainAction({ input: z.object({}), run: () => Promise.resolve("ok") });

    const error = await grab(() => handlerOf<Record<string, never>, string>(action)({}, makeContext(undefined)));
    expect(error).toBeInstanceOf(ActionError);
    expect((error as ActionError).code).toBe("UNAUTHORIZED");
  });

  it("checks the session before the capability, so a signed-out caller is UNAUTHORIZED", async () => {
    const action = defineDomainAction({ input: z.object({}), run: () => Promise.resolve("ok") });

    const error = await grab(() => handlerOf<Record<string, never>, string>(action)({}, makeContext(undefined, NONE)));
    expect((error as ActionError).code).toBe("UNAUTHORIZED");
  });

  it("requires edit by default: a viewer is FORBIDDEN before the client resolves or run starts", async () => {
    // Unconfigured, so reaching requireSupabase would throw INTERNAL_SERVER_ERROR instead.
    mockState.client = null;
    const run = vi.fn(() => Promise.resolve("ok"));
    const action = defineDomainAction({ input: z.object({}), run });

    const error = await grab(() =>
      handlerOf<Record<string, never>, string>(action)({}, makeContext({ id: "u1" }, VIEWER)),
    );
    expect(error).toBeInstanceOf(ActionError);
    expect((error as ActionError).code).toBe("FORBIDDEN");
    expect(run).not.toHaveBeenCalled();
  });

  it("lets a declared read through for a viewer and refuses it to a role-less user", async () => {
    mockState.client = { tag: "client" };
    const action = defineDomainAction({ input: z.object({}), run: () => Promise.resolve("ok"), requires: "read" });
    const handler = handlerOf<Record<string, never>, string>(action);

    await expect(handler({}, makeContext({ id: "u1" }, VIEWER))).resolves.toBe("ok");
    const error = await grab(() => handler({}, makeContext({ id: "u1" }, NONE)));
    expect((error as ActionError).code).toBe("FORBIDDEN");
  });

  it("surfaces a write RLS refuses with 42501, past the guard, as FORBIDDEN", async () => {
    mockState.client = { tag: "client" };
    const refused = {
      data: null,
      error: { code: INSUFFICIENT_PRIVILEGE, message: "new row violates row-level security" },
    };
    const action = defineDomainAction({
      input: z.object({}),
      run: () => Promise.resolve().then(() => unwrapRow(refused, { failure: "Failed to write" })),
    });

    const error = await grab(() => handlerOf<Record<string, never>, never>(action)({}, makeContext({ id: "u1" })));
    expect(error).toBeInstanceOf(ActionError);
    expect((error as ActionError).code).toBe("FORBIDDEN");
  });

  it("lets a declared session action through for a role-less user", async () => {
    mockState.client = { tag: "client" };
    const action = defineDomainAction({ input: z.object({}), run: () => Promise.resolve("ok"), requires: "session" });

    await expect(handlerOf<Record<string, never>, string>(action)({}, makeContext({ id: "u1" }, NONE))).resolves.toBe(
      "ok",
    );
  });
});
