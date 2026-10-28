import { ActionError, type ActionAPIContext } from "astro:actions";
import { describe, expect, it } from "vitest";
import type { AccessState, Capability } from "@/shared/config";
import { FORBIDDEN_MESSAGE } from "@/shared/lib/errors";
import { requireCapability } from "./require-capability";

type Outcome = "pass" | "FORBIDDEN" | "SERVICE_UNAVAILABLE";
type AccessLabel = "admin" | "author" | "viewer" | "none" | "unavailable";

const ACCESS: Record<AccessLabel, AccessState> = {
  admin: { status: "granted", role: "admin" },
  author: { status: "granted", role: "author" },
  viewer: { status: "granted", role: "viewer" },
  none: { status: "none" },
  unavailable: { status: "unavailable" },
};

// The guard's whole decision table, every capability × access state (S-403). `session` passes in
// every state; a failed lookup is never reported as "no permission".
const EXPECTED: Record<Capability, Record<AccessLabel, Outcome>> = {
  session: { admin: "pass", author: "pass", viewer: "pass", none: "pass", unavailable: "pass" },
  read: { admin: "pass", author: "pass", viewer: "pass", none: "FORBIDDEN", unavailable: "SERVICE_UNAVAILABLE" },
  edit: {
    admin: "pass",
    author: "pass",
    viewer: "FORBIDDEN",
    none: "FORBIDDEN",
    unavailable: "SERVICE_UNAVAILABLE",
  },
};

const CASES = (Object.keys(EXPECTED) as Capability[]).flatMap((capability) =>
  (Object.keys(ACCESS) as AccessLabel[]).map((access) => ({
    capability,
    access,
    expected: EXPECTED[capability][access],
  })),
);

describe("requireCapability", () => {
  it.each(CASES)("$capability for $access: $expected", ({ capability, access, expected }) => {
    expect(outcomeOf(capability, ACCESS[access])).toBe(expected);
  });

  it("tells a refused caller they lack permission, in the words RLS's 42501 maps to", () => {
    expect(thrownBy("edit", ACCESS.viewer)?.message).toBe(FORBIDDEN_MESSAGE);
  });
});

function outcomeOf(capability: Capability, access: AccessState): Outcome {
  const error = thrownBy(capability, access);
  if (!error) return "pass";
  if (error.code === "FORBIDDEN" || error.code === "SERVICE_UNAVAILABLE") return error.code;
  throw new Error(`unexpected code ${error.code}`);
}

function thrownBy(capability: Capability, access: AccessState): ActionError | undefined {
  try {
    requireCapability(contextWith(access), capability);
    return undefined;
  } catch (error) {
    if (error instanceof ActionError) return error;
    throw error;
  }
}

// Cast through unknown: the stub's context is a minimal shape, but tsc/eslint see the real
// astro:actions `ActionAPIContext`.
const contextWith = (access: AccessState): ActionAPIContext =>
  ({
    locals: { user: { id: "u1" }, access },
    request: new Request("http://localhost/_actions/test", { method: "POST" }),
    cookies: {},
  }) as unknown as ActionAPIContext;
