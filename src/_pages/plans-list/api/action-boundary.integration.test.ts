import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { ActionError, type ActionAPIContext } from "astro:actions";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "@/shared/api";
import { registerPlan, teardown } from "@/test/factories";
import { createPlanInput } from "../model/schemas";

// Exercises the Astro Action wrapper through its `.handler` against the real local
// Supabase — the seam Risk #3 targets ("the handler wiring is what is untested").
// Drives the FULL wrapper (requireSession → requireSupabase → runDomain), not the
// domain function in isolation, so the DomainError→ActionError translation is proven
// end to end from a real Postgres error.
//
// `requireSupabase` resolves its client from `@/shared/api`'s env-reading
// `createClient`, which is null under Vitest — so we mock that one export to return a
// real service-role client (the same controllable-mock pattern the wrapper's unit
// test uses, but yielding a live client instead of a fake). Everything else in the
// barrel (unwrapRow, types) passes through untouched.
//
// Scope note — CONFLICT is intentionally absent: `plans.name` has no unique
// constraint and no plans-list domain fn maps a `conflict` message (only the
// courses/teachers slices do), so a real CONFLICT is unreachable through any
// plans-list action. Its 1:1 translation (CONFLICT → ActionError(CONFLICT)) is
// already unit-covered in define-domain-action.test.ts, and toDomainError's
// 23505→CONFLICT branch in unwrap/to-domain-error tests — manufacturing it through a
// cross-slice action here would only duplicate that, and break FSD slice isolation.
const { mockState } = vi.hoisted((): { mockState: { client: unknown } } => ({ mockState: { client: null } }));
vi.mock("@/shared/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/shared/api")>();
  return { ...actual, createClient: () => mockState.client };
});

const { planActions } = await import("./actions");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const hasEnv = Boolean(SUPABASE_URL && SERVICE_KEY);

// Cast through unknown: the stub types `locals.user` as `unknown`, but tsc/eslint see
// the real astro:actions `ActionAPIContext` whose `locals.user` is `User | null`.
const signedIn = (): ActionAPIContext =>
  ({
    locals: { user: { id: "e2e-author" } },
    request: new Request("http://localhost/_actions/test", { method: "POST" }),
    cookies: {},
  }) as unknown as ActionAPIContext;

// The stub's `defineAction` returns the raw `{ input, handler }` object, but the real
// astro:actions types hide `.handler`/`.input` on the action client — reach them
// through casts that match the stub's runtime shape.
type DomainHandler<I, O> = (input: I, context: ActionAPIContext) => Promise<O>;
const handlerOf = <I, O>(action: unknown): DomainHandler<I, O> => (action as { handler: DomainHandler<I, O> }).handler;
const inputOf = (action: unknown): typeof createPlanInput => (action as { input: typeof createPlanInput }).input;

// Capture a thrown error whether the handler throws synchronously or rejects async.
const grab = async (fn: () => unknown): Promise<unknown> => {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  throw new Error("expected the handler to throw");
};

(hasEnv ? describe : describe.skip)("plan action boundary (.handler over local Supabase)", () => {
  let supabase: SupabaseClient<Database>;

  beforeAll(() => {
    if (!SUPABASE_URL || !SERVICE_KEY) return;
    supabase = createSupabaseClient<Database>(SUPABASE_URL, SERVICE_KEY);
    mockState.client = supabase; // requireSupabase() now hands the real client to the domain fn
  });

  afterAll(async () => {
    await teardown(supabase);
  });

  it("translates a real not-found (PGRST116) to ActionError(NOT_FOUND) with the verbatim message", async () => {
    // renamePlan on a non-existent id makes `.single()` match zero rows → PostgREST
    // PGRST116 → unwrapRow → DomainError("NOT_FOUND", "Plan not found.") → runDomain →
    // ActionError. Asserts the real code passes through 1:1 and the message is verbatim.
    const error = await grab(() =>
      handlerOf<{ id: string; name: string }, unknown>(planActions.renamePlan)(
        { id: "00000000-0000-4000-8000-000000000000", name: "ghost" },
        signedIn(),
      ),
    );

    expect(error).toBeInstanceOf(ActionError);
    expect((error as ActionError).code).toBe("NOT_FOUND");
    expect((error as ActionError).message).toBe("Plan not found.");
  });

  it("drives createPlan through the full handler and persists the row", async () => {
    const created = await handlerOf<{ name: string; slotGridPreset: string }, { id: string; slot_grid_preset: string }>(
      planActions.createPlan,
    )({ name: "Action Boundary Create", slotGridPreset: "5x8" }, signedIn());
    registerPlan(created.id);

    expect(created.slot_grid_preset).toBe("5x8");

    // Confirm it actually landed in Postgres — persistence through the wrapper, not
    // just a returned object.
    const { data } = await supabase.from("plans").select("name").eq("id", created.id).single();
    expect(data?.name).toBe("Action Boundary Create");
  });

  it("rejects malformed input at the action's declared input gate", () => {
    // The stubbed defineAction is a passthrough that does not run Astro's input
    // validation, so assert the action's own declared `input` schema — the
    // authoritative server gate Astro applies before the handler body — rejects a
    // bad payload (empty name, off-enum preset).
    const parsed = inputOf(planActions.createPlan).safeParse({ name: "", slotGridPreset: "9x9" });
    expect(parsed.success).toBe(false);
  });
});
