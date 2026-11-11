import { readMessage, waitForMessageTo } from "../../src/test/mailpit";

/** An email that carries a one-time link: its Mailpit id (to delete it) and the link it carries. */
export type ConfirmMail = { id: string; created: string; link: string };

/**
 * Wait for the next email to `address` (newer than `after`, when given) and read the one
 * `/auth/confirm` link it carries, whatever its type: a reset (S-402) or an invitation (S-410).
 * Mail sent through the preview Worker can take a few seconds, hence the longer wait. The caller
 * deletes the message by id when done (Mailpit is shared: never delete without ids).
 */
export async function waitForConfirmLink(address: string, { after }: { after?: string } = {}): Promise<ConfirmMail> {
  const message = await waitForMessageTo(address, { after, timeoutMs: 15_000 });
  return { id: message.ID, created: message.Created, link: confirmLinkIn((await readMessage(message.ID)).HTML) };
}

/** The one link an Auth email carries, with HTML's `&amp;` decoded. Throws unless it opens `/auth/confirm`. */
export function confirmLinkIn(html: string): string {
  const href = /href="([^"]+)"/.exec(html)?.[1]?.replaceAll("&amp;", "&");
  if (!href?.includes("/auth/confirm?token_hash=")) throw new Error("no confirm link in the email");
  return href;
}
