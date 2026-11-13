import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database, SupabaseClient } from "@/shared/api";
import { createPlan, createSignedInUser, registerPlan, teardown, type SignedInUser } from "@/test/factories";
import { ACCESS_ALREADY_CHANGED_MESSAGE } from "./constants";
import { setUserActive } from "./set-user-active";

/**
 * Deactivation on a session that already exists (S-408): the gap the role matrix leaves, since the
 * matrix deactivates its principal before that principal signs in. The author signs in first and
 * keeps the same client, with the same unexpired token, throughout: their access ends on the next
 * request after the admin's write, and returns on the next request after the reactivation, with no
 * new sign-in. Run as the action runs it: the domain function on the admin's publishable-key client,
 * so RLS, the guard and the recording trigger judge it exactly as they judge the page. (The action's
 * own `requires: "manage_users"` is pinned by `src/actions/action-capabilities.test.ts`.)
 */
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const hasEnv = Boolean(SUPABASE_URL && SERVICE_KEY);

(hasEnv ? describe : describe.skip)("setUserActive (local Supabase)", () => {
  let service: SupabaseClient;
  let admin: SignedInUser;
  let author: SignedInUser;
  let planId: string;

  beforeAll(async () => {
    if (!SUPABASE_URL || !SERVICE_KEY) return;
    service = createClient<Database>(SUPABASE_URL, SERVICE_KEY);
    [admin, author] = await Promise.all([
      createSignedInUser(service, { role: "admin" }),
      createSignedInUser(service, { role: "author" }),
    ]);
    planId = await createPlan(service);
  });

  afterAll(async () => {
    await teardown(service);
  });

  it("ends a signed-in author's access on their next request, and reactivation restores it on the same token", async () => {
    expect(await accessOf(author.client, planId)).toEqual({ role: "author", plansSeen: 1, insertRefusal: null });

    await setUserActive(admin.client, { userId: author.id, active: false });
    expect(await accessOf(author.client, planId)).toEqual({ role: null, plansSeen: 0, insertRefusal: "42501" });

    await expect(setUserActive(admin.client, { userId: author.id, active: false })).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: ACCESS_ALREADY_CHANGED_MESSAGE,
    });

    await setUserActive(admin.client, { userId: author.id, active: true });
    expect(await accessOf(author.client, planId)).toEqual({ role: "author", plansSeen: 1, insertRefusal: null });

    expect(await activationRecordsOf(service, author.id)).toEqual([
      { kind: "deactivated", actor_id: admin.id, old_role: "author", new_role: "author" },
      { kind: "reactivated", actor_id: admin.id, old_role: "author", new_role: "author" },
    ]);
  });

  it("does not reactivate a row whose ban is recorded, and leaves the pause in place", async () => {
    // The shared author, restored after the read-back. A fresh account would be deleted with the
    // admin in teardown, and those two deletes deadlock on the access record that names both.
    await setUserActive(admin.client, { userId: author.id, active: false });
    const marked = await service
      .from("user_directory")
      .update({ banned_at: new Date().toISOString() })
      .eq("user_id", author.id);
    if (marked.error) throw new Error(`setup failed: ${marked.error.message}`);

    await expect(setUserActive(admin.client, { userId: author.id, active: true })).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: ACCESS_ALREADY_CHANGED_MESSAGE,
    });

    const role = await service.from("user_roles").select("deactivated_at").eq("user_id", author.id).maybeSingle();
    if (role.error) throw new Error(`read-back failed: ${role.error.message}`);
    const directory = await service.from("user_directory").select("banned_at").eq("user_id", author.id).maybeSingle();
    if (directory.error) throw new Error(`read-back failed: ${directory.error.message}`);
    expect(role.data?.deactivated_at).not.toBeNull();
    expect(directory.data?.banned_at).not.toBeNull();

    const cleared = await service.from("user_directory").update({ banned_at: null }).eq("user_id", author.id);
    if (cleared.error) throw new Error(`restore failed: ${cleared.error.message}`);
    await setUserActive(admin.client, { userId: author.id, active: true });
  });
});

type Access = { role: string | null; plansSeen: number; insertRefusal: string | null };

/**
 * What the session reaches right now: the role the app reads, whether it sees the plan, and whether
 * a plan insert is refused (the SQLSTATE, or null when it lands). The insert's id is registered for
 * teardown first, so a landed one is cleaned up.
 */
const accessOf = async (client: SupabaseClient, planId: string): Promise<Access> => {
  const role = await client.rpc("own_app_role");
  if (role.error) throw new Error(`own_app_role failed: ${role.error.message}`);
  const plans = await client.from("plans").select("id").eq("id", planId);
  if (plans.error) throw new Error(`plan read failed: ${plans.error.message}`);
  const id = randomUUID();
  registerPlan(id);
  const insert = await client.from("plans").insert({ id, name: `Factory Plan ${id}`, slot_grid_preset: "5x10" });
  return { role: role.data, plansSeen: plans.data.length, insertRefusal: insert.error?.code ?? null };
};

/** The deactivation and reactivation records naming `target`, oldest first, read as the service role. */
const activationRecordsOf = async (service: SupabaseClient, target: string) => {
  const { data, error } = await service
    .from("access_changes")
    .select("kind, actor_id, old_role, new_role")
    .eq("target_id", target)
    .in("kind", ["deactivated", "reactivated"])
    .order("id");
  if (error) throw new Error(`read-back failed: ${error.message}`);
  return data;
};
