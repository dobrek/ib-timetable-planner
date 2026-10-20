import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { updatePassword } from "@/_pages/account/api/update-password";
import { type EmailLink, parseEmailLink, requestPasswordReset, verifyEmailLink } from "@/_pages/password-recovery";
import type { Database, SupabaseClient } from "@/shared/api";
import { createAuthUser, teardown } from "@/test/factories";
import { deleteMessages, type MailSummary, messagesTo, readMessage, waitForMessageTo } from "./mailpit";
import { createPublishableClient } from "./publishable-client";
import { readPublishableKey } from "./publishable-key";

/**
 * S-402's two Auth calls against the real local GoTrue and Mailpit, through publishable-key clients
 * like the Worker's — the mechanics nobody can see in review: what the email carries, that its link
 * works from a client that never asked for it, once, and only while it is the newest.
 *
 * - **Needs the stack restarted on the S-402 config** (`supabase stop && supabase start`): the
 *   templates and `site_url = http://localhost:4321` apply only then, and an old stack fails here
 *   on the subject and the link host.
 * - **Requests go through `createPublishableClient`**, whose supabase-js default is the implicit
 *   flow with no stored session — the same options as the Worker's `createSessionlessClient`, which
 *   reads `astro:env` and cannot run here. The bare hash in every link proves no PKCE was involved.
 * - **A small rate-limit budget.** Every Auth call here shares GoTrue's per-IP buckets with the
 *   rest of the lane (30 per 5 minutes for `/recover` and for `/verify`): users come from the admin
 *   API with no sign-in, and a run makes about ten requests and six verifications.
 * - Each test has its own user and address, and deletes only its own mail, by id.
 */
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PUBLISHABLE_KEY = readPublishableKey();
const hasEnv = Boolean(SUPABASE_URL && SERVICE_KEY && PUBLISHABLE_KEY);

const RECOVERY_SUBJECT = "Reset your IB Planner password";
const CHANGED_SUBJECT = "Your IB Planner password was changed";
const CONFIRM_LINK = /^http:\/\/localhost:4321\/auth\/confirm\?token_hash=[0-9a-f]{56}&type=recovery$/;

(hasEnv ? describe : describe.skip)("password recovery (local Supabase + Mailpit)", () => {
  let admin: SupabaseClient;
  const ownMail = new Set<string>();

  beforeAll(() => {
    if (!SUPABASE_URL || !SERVICE_KEY) return;
    admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY);
  });

  afterAll(async () => {
    if (ownMail.size > 0) await deleteMessages([...ownMail]);
    await teardown(admin);
  });

  it("sends nothing for an unknown address, and answers as if it had", async () => {
    const unknown = `unknown-${randomUUID()}@example.test`;
    const known = await createAuthUser(admin);

    expect((await requestPasswordReset(signedOutClient(), unknown)).outcome).toBe("accepted");
    // The ordering bound: a reset requested after the unknown one has arrived, so the unknown one
    // would have arrived by now too.
    await requestReset(known.email);
    await nextMessageTo(known.email);

    expect(await messagesTo(unknown)).toEqual([]);
  });

  it("emails a known user exactly one link, to /auth/confirm, carrying the hash and the type", async () => {
    const user = await createAuthUser(admin);

    await requestReset(user.email);
    const message = await nextMessageTo(user.email);
    const { HTML } = await readMessage(message.ID);

    expect(message.Subject).toBe(RECOVERY_SUBJECT);
    const urls = urlsIn(HTML);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toMatch(CONFIRM_LINK);
    expect(HTML).not.toMatch(/<form|<script|<img/i);
    expect(parseEmailLink(new URL(urls.at(0) ?? "about:blank").searchParams)?.type).toBe("recovery");
    expect((await messagesTo(user.email)).map((mail) => mail.ID)).toEqual([message.ID]);
  });

  it("verifies from a client that never asked for the link, which then holds the user's session", async () => {
    const user = await createAuthUser(admin);
    const link = await requestLink(user.email);
    const otherDevice = signedOutClient();

    expect(await verifyEmailLink(otherDevice, link)).toEqual({ ok: true });

    const { data } = await otherDevice.auth.getUser();
    expect(data.user?.id).toBe(user.id);
  });

  it("works once: the same link a second time is expired", async () => {
    const user = await createAuthUser(admin);
    const link = await requestLink(user.email);

    expect(await verifyEmailLink(signedOutClient(), link)).toEqual({ ok: true });
    expect(await verifyEmailLink(signedOutClient(), link)).toEqual({ ok: false, reason: "expired" });
  });

  it("kills the older link when a newer one is requested", async () => {
    const user = await createAuthUser(admin);
    const first = await nextMessageTo(user.email, await requestReset(user.email));
    const firstLink = await linkIn(first);

    // The local resend interval is 1 s (hosted: 300 s); retry past it rather than sleep a fixed time.
    await retryUntilAccepted(user.email);
    const secondLink = await linkIn(await nextMessageTo(user.email, { after: first.Created }));

    expect(secondLink.tokenHash).not.toBe(firstLink.tokenHash);
    expect(await verifyEmailLink(signedOutClient(), firstLink)).toEqual({ ok: false, reason: "expired" });
    expect(await verifyEmailLink(signedOutClient(), secondLink)).toEqual({ ok: true });
  });

  it("lets the recovery session set a new password, and tells the owner it changed", async () => {
    const oldPassword = strongPassword();
    const user = await createAuthUser(admin, { password: oldPassword });
    const recovery = await nextMessageTo(user.email, await requestReset(user.email));
    const session = signedOutClient();
    expect(await verifyEmailLink(session, await linkIn(recovery))).toEqual({ ok: true });
    const newPassword = strongPassword();

    await updatePassword(session, { password: newPassword });

    expect((await signIn(user.email, newPassword)).error).toBeNull();
    expect((await signIn(user.email, oldPassword)).error?.code).toBe("invalid_credentials");
    const notice = await nextMessageTo(user.email, { after: recovery.Created });
    expect(notice.Subject).toBe(CHANGED_SUBJECT);
    const { HTML } = await readMessage(notice.ID);
    expect(urlsIn(HTML)).toEqual(["http://localhost:4321/auth/forgot"]);
    expect(HTML).toContain(user.email);
  });

  /** Ask for a reset and require GoTrue to accept it; returns the `after` bound for its email. */
  const requestReset = async (email: string): Promise<{ after?: string }> => {
    const before = (await messagesTo(email)).at(0);
    expect(await requestPasswordReset(signedOutClient(), email)).toEqual({
      outcome: "accepted",
      code: null,
      status: null,
    });
    return before ? { after: before.Created } : {};
  };

  const retryUntilAccepted = async (email: string): Promise<void> => {
    for (let attempt = 1; ; attempt++) {
      const { outcome } = await requestPasswordReset(signedOutClient(), email);
      if (outcome === "accepted") return;
      expect(outcome).toBe("throttled");
      if (attempt === 6) throw new Error("the resend interval never let a second request through");
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  };

  const nextMessageTo = async (email: string, bound: { after?: string } = {}): Promise<MailSummary> => {
    const message = await waitForMessageTo(email, bound);
    ownMail.add(message.ID);
    return message;
  };

  const requestLink = async (email: string): Promise<EmailLink> =>
    linkIn(await nextMessageTo(email, await requestReset(email)));
});

const linkIn = async (message: MailSummary): Promise<EmailLink> => {
  const url = urlsIn((await readMessage(message.ID)).HTML).at(0);
  const link = url ? parseEmailLink(new URL(url).searchParams) : null;
  if (!link) throw new Error(`no email link in message ${message.ID}`);
  return link;
};

/** Every absolute URL in an email body, attribute or text, with HTML's `&amp;` decoded. */
const urlsIn = (html: string): string[] =>
  [...html.matchAll(/https?:\/\/[^\s"'<>)]+/g)].map(([url]) => url.replaceAll("&amp;", "&"));

// 40 characters, all four classes, no `#`, quotes or whitespace — like `createSignedInUser`'s own.
const strongPassword = (): string => `${randomUUID()}Aa1!`;

const signedOutClient = (): SupabaseClient => {
  if (!SUPABASE_URL || !PUBLISHABLE_KEY) throw new Error("no local Supabase env");
  return createPublishableClient(SUPABASE_URL, PUBLISHABLE_KEY);
};

const signIn = (email: string, password: string) => signedOutClient().auth.signInWithPassword({ email, password });
