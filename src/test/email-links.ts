import { type EmailLink, parseEmailLink } from "@/_pages/password-recovery";
import { type MailSummary, readMessage } from "./mailpit";

/** The link a message carries: its first URL, parsed as the confirm page parses it. Throws if none. */
export const linkIn = async (message: MailSummary): Promise<EmailLink> => {
  const url = urlsIn((await readMessage(message.ID)).HTML).at(0);
  const link = url ? parseEmailLink(new URL(url).searchParams) : null;
  if (!link) throw new Error(`no email link in message ${message.ID}`);
  return link;
};

/** Every absolute URL in an email body, attribute or text, with HTML's `&amp;` decoded. */
export const urlsIn = (html: string): string[] =>
  [...html.matchAll(/https?:\/\/[^\s"'<>)]+/g)].map(([url]) => url.replaceAll("&amp;", "&"));
