import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database, SupabaseClient } from "@/shared/api";
import type { AppRole } from "@/shared/config";
import { createAuthUser, createSignedInUser, teardown, type SignedInUser } from "@/test/factories";

/**
 * The access-change record (S-406): every role write is recorded with who made it and when,
 * whatever path it takes.
 *
 * Driven through the Data API as a signed-in admin, because the actor is `auth.uid()` from the
 * session and the INSERT policy holds only for that session's own trigger. Every target is a
 * throwaway user, and the admin is one too, with a second throwaway admin present, so its own
 * demotion is deterministic whatever other admins the database holds. Records are read back as the
 * service role. The role matrix owns who may read them.
 */
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const hasEnv = Boolean(SUPABASE_URL && SERVICE_KEY);

type AccessChange = Pick<
  Database["public"]["Tables"]["access_changes"]["Row"],
  "kind" | "actor_kind" | "actor_id" | "target_id" | "old_role" | "new_role"
>;

(hasEnv ? describe : describe.skip)("access-change record (local Supabase)", () => {
  let service: SupabaseClient;
  let admin: SignedInUser;

  beforeAll(async () => {
    if (!SUPABASE_URL || !SERVICE_KEY) return;
    service = createClient<Database>(SUPABASE_URL, SERVICE_KEY);
    admin = await createSignedInUser(service, { role: "admin" });
    // Another admin, so the signed-in one may step down at the end.
    await userWithRole(service, "admin");
  });

  afterAll(async () => {
    await teardown(service);
  });

  it("changing a user's role records role_changed, with the admin as the actor", async () => {
    const target = await userWithRole(service, "author");
    expect((await admin.client.from("user_roles").update({ role: "viewer" }).eq("user_id", target)).error).toBeNull();
    expect(await recordsNaming(service, target)).toEqual([
      operatorGrant(target, "author"),
      byAdmin("role_changed", target, "author", "viewer"),
    ]);
  });

  it("giving a role-less user a role records role_granted", async () => {
    const { id: target } = await createAuthUser(service);
    expect((await admin.client.from("user_roles").insert({ user_id: target, role: "viewer" })).error).toBeNull();
    expect(await recordsNaming(service, target)).toEqual([byAdmin("role_granted", target, null, "viewer")]);
  });

  it("removing a user's role records role_removed", async () => {
    const target = await userWithRole(service, "author");
    expect((await admin.client.from("user_roles").delete().eq("user_id", target)).error).toBeNull();
    expect(await recordsNaming(service, target)).toEqual([
      operatorGrant(target, "author"),
      byAdmin("role_removed", target, "author", null),
    ]);
  });

  it("an upsert that changes the role records one role_changed, never a role_granted", async () => {
    // The action's write path. BEFORE INSERT fires for the proposed row even when it conflicts,
    // which is why grants are recorded AFTER INSERT (plan probe P8).
    const target = await userWithRole(service, "author");
    expect(
      (await admin.client.from("user_roles").upsert({ user_id: target, role: "viewer" }, { onConflict: "user_id" }))
        .error,
    ).toBeNull();
    expect(await recordsNaming(service, target)).toEqual([
      operatorGrant(target, "author"),
      byAdmin("role_changed", target, "author", "viewer"),
    ]);
  });

  it("an upsert that leaves the role as it was records nothing", async () => {
    const target = await userWithRole(service, "author");
    expect(
      (await admin.client.from("user_roles").upsert({ user_id: target, role: "author" }, { onConflict: "user_id" }))
        .error,
    ).toBeNull();
    expect(await recordsNaming(service, target)).toEqual([operatorGrant(target, "author")]);
  });

  it("a service-role write is recorded as the operator, with no actor id", async () => {
    const target = await userWithRole(service, "author");
    expect((await service.from("user_roles").update({ role: "viewer" }).eq("user_id", target)).error).toBeNull();
    expect(await recordsNaming(service, target)).toEqual([
      operatorGrant(target, "author"),
      {
        kind: "role_changed",
        actor_kind: "operator",
        actor_id: null,
        target_id: target,
        old_role: "author",
        new_role: "viewer",
      },
    ]);
  });

  // Last: the admin is no longer one afterwards.
  it("an admin may demote themselves while another admin remains, and it is recorded", async () => {
    expect((await admin.client.from("user_roles").update({ role: "viewer" }).eq("user_id", admin.id)).error).toBeNull();
    expect(await recordsNaming(service, admin.id)).toEqual([
      operatorGrant(admin.id, "admin"),
      byAdmin("role_changed", admin.id, "admin", "viewer"),
    ]);
    // Effective at once, for the same session: the next request is judged as a viewer.
    expect(await admin.client.rpc("own_app_role")).toMatchObject({ error: null, data: "viewer" });
  });

  const byAdmin = (
    kind: AccessChange["kind"],
    target: string,
    oldRole: AppRole | null,
    newRole: AppRole | null,
  ): AccessChange => ({
    kind,
    actor_kind: "user",
    actor_id: admin.id,
    target_id: target,
    old_role: oldRole,
    new_role: newRole,
  });
});

/** A fresh user given `role` by the service role, and its id. */
const userWithRole = async (service: SupabaseClient, role: AppRole): Promise<string> => {
  const { id } = await createAuthUser(service);
  const { error } = await service.from("user_roles").insert({ user_id: id, role });
  if (error) throw new Error(`setup failed: ${error.message}`);
  return id;
};

/** The record of the factory's own grant: the service role is the operator. */
const operatorGrant = (target: string, role: AppRole): AccessChange => ({
  kind: "role_granted",
  actor_kind: "operator",
  actor_id: null,
  target_id: target,
  old_role: null,
  new_role: role,
});

/** Every record naming `target`, oldest first. Throws on any error. */
const recordsNaming = async (service: SupabaseClient, target: string): Promise<AccessChange[]> => {
  const { data, error } = await service
    .from("access_changes")
    .select("kind, actor_kind, actor_id, target_id, old_role, new_role")
    .eq("target_id", target)
    .order("id");
  if (error) throw new Error(`read-back failed: ${error.message}`);
  return data;
};
