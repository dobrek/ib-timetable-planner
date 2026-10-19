import { randomUUID } from "node:crypto";
import { createClient, isAuthSessionMissingError } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DISPLAY_NAME_REFUSED_MESSAGE,
  PASSWORD_REUSED_MESSAGE,
  PASSWORD_TOO_SHORT_MESSAGE,
} from "@/_pages/account/api/constants";
import { updateDisplayName } from "@/_pages/account/api/update-display-name";
import { updatePassword } from "@/_pages/account/api/update-password";
import type { Database, SupabaseClient } from "@/shared/api";
import { DomainError } from "@/shared/lib/errors";
import { createSignedInUser, teardown } from "@/test/factories";
import { createPublishableClient } from "./publishable-client";
import { readPublishableKey } from "./publishable-key";

/**
 * S-401's domain functions against the real local Auth server and database, through the
 * publishable-key session a browser holds — including the one behaviour nobody can see in review:
 * a password change signs the user's other sessions out.
 *
 * - The password claims need the stack on `minimum_password_length = 15` (`supabase/config.toml`);
 *   on an older stack the 14-character case passes GoTrue and this file goes red.
 * - The name CHECK is proven here, once, by calling the domain function around Zod (F7). Access
 *   claims about `profiles` live in the role matrix, not here.
 * - Each test changes a password, so each gets its own user: about ten sign-ins per run, well
 *   inside GoTrue's 30-per-5-minutes `sign_in_sign_ups` limit.
 */
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PUBLISHABLE_KEY = readPublishableKey();
const hasEnv = Boolean(SUPABASE_URL && SERVICE_KEY && PUBLISHABLE_KEY);

(hasEnv ? describe : describe.skip)("account self-service (local Supabase)", () => {
  let admin: SupabaseClient;

  beforeAll(() => {
    if (!SUPABASE_URL || !SERVICE_KEY) return;
    admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY);
  });

  afterAll(async () => {
    await teardown(admin);
  });

  describe("updatePassword", () => {
    it("changes the password: the new one signs in, the old one no longer does", async () => {
      const user = await createSignedInUser(admin);
      const next = strongPassword();

      await updatePassword(user.client, { password: next });

      expect((await signIn(user.email, next)).error).toBeNull();
      expect((await signIn(user.email, user.password)).error?.code).toBe("invalid_credentials");
    });

    it("is refused under 15 characters by the Auth server itself, not only by the form", async () => {
      const user = await createSignedInUser(admin);

      await expectRefusal(updatePassword(user.client, { password: "a".repeat(14) }), PASSWORD_TOO_SHORT_MESSAGE);
      expect((await signIn(user.email, user.password)).error).toBeNull();
    });

    it("is refused when the new password is the current one", async () => {
      const user = await createSignedInUser(admin);

      await expectRefusal(updatePassword(user.client, { password: user.password }), PASSWORD_REUSED_MESSAGE);
    });

    it("keeps this session and signs the user's other sessions out", async () => {
      const user = await createSignedInUser(admin);
      const otherDevice = signedOutClient();
      expect(
        (await otherDevice.auth.signInWithPassword({ email: user.email, password: user.password })).error,
      ).toBeNull();
      // Proves the second session is live first: a client holding no session fails the same way.
      expect((await otherDevice.auth.getUser()).error).toBeNull();

      await updatePassword(user.client, { password: strongPassword() });

      expect((await user.client.auth.getUser()).error).toBeNull();
      const { error } = await otherDevice.auth.getUser();
      expect(isAuthSessionMissingError(error)).toBe(true);
    });
  });

  describe("updateDisplayName", () => {
    it("creates the caller's row through the auth.uid() default, then updates and clears it", async () => {
      const user = await createSignedInUser(admin);

      await updateDisplayName(user.client, { displayName: "Ada" });
      const created = await profileOf(user.id);
      expect(created?.display_name).toBe("Ada");

      await updateDisplayName(user.client, { displayName: "Ada Lovelace" });
      const updated = await profileOf(user.id);
      expect(updated?.display_name).toBe("Ada Lovelace");
      expect(updated?.updated_at).not.toBe(created?.updated_at);

      await updateDisplayName(user.client, { displayName: null });
      expect((await profileOf(user.id))?.display_name).toBeNull();
    });

    it("is refused by the CHECK for a name the form would have refused", async () => {
      const user = await createSignedInUser(admin);
      const bidiOverride = String.fromCodePoint(0x202e);

      await expectRefusal(
        updateDisplayName(user.client, { displayName: `Ada${bidiOverride}` }),
        DISPLAY_NAME_REFUSED_MESSAGE,
      );
      await expectRefusal(
        updateDisplayName(user.client, { displayName: "a".repeat(61) }),
        DISPLAY_NAME_REFUSED_MESSAGE,
      );
      expect(await profileOf(user.id)).toBeNull();
    });
  });

  const profileOf = async (userId: string) => {
    const { data, error } = await admin
      .from("profiles")
      .select("display_name, updated_at")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(`profileOf: ${error.message}`);
    return data;
  };
});

// 40 characters, all four classes, no `#`, quotes or whitespace — like `createSignedInUser`'s own.
const strongPassword = (): string => `${randomUUID()}Aa1!`;

const signedOutClient = (): SupabaseClient => {
  if (!SUPABASE_URL || !PUBLISHABLE_KEY) throw new Error("no local Supabase env");
  return createPublishableClient(SUPABASE_URL, PUBLISHABLE_KEY);
};

const signIn = (email: string, password: string) => signedOutClient().auth.signInWithPassword({ email, password });

/** The refusal a form field shows. The message names which rule fired — two of them share the code. */
const expectRefusal = async (attempt: Promise<void>, message: string): Promise<void> => {
  const error = await attempt.then(
    () => null,
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(DomainError);
  expect(error).toMatchObject({ code: "UNPROCESSABLE_CONTENT", message });
};
