/**
 * The email-link types `/auth/confirm` accepts. The page is shared infrastructure for every Auth
 * email that carries a one-time link: S-410 adds `invite` and S-411 adds `email_change` here and
 * in `LANDING_PATHS` below, and nothing else needs to change. A type outside this list is refused
 * before GoTrue is ever called.
 */
export const EMAIL_LINK_TYPES = ["recovery"] as const;

export type EmailLinkType = (typeof EMAIL_LINK_TYPES)[number];

/** A one-time email link as the template builds it: `?token_hash=…&type=…`. */
export type EmailLink = { tokenHash: string; type: EmailLinkType };

/**
 * Read an email link from the confirm page's query string or the Continue form's body. Both
 * `URLSearchParams` and `FormData` fit `params`, so the page and the endpoint share one rule.
 *
 * Refuses a missing, empty, over-long or odd-character `token_hash`, and any `type` outside
 * `EMAIL_LINK_TYPES`. GoTrue's hash is 56 hex characters, with a `pkce_` prefix on PKCE flows.
 */
export function parseEmailLink(params: { get(name: string): unknown }): EmailLink | null {
  const tokenHash = params.get("token_hash");
  const type = params.get("type");
  if (!isTokenHash(tokenHash) || !isEmailLinkType(type)) return null;
  return { tokenHash, type };
}

/**
 * Where a spent link lands, signed in. A recovery lands on the account page's password form with a
 * banner (`AccountPage.astro` reads `notice=recovery`), which a user with no role can still reach.
 */
export function landingPathFor(type: EmailLinkType): string {
  return LANDING_PATHS[type];
}

const LANDING_PATHS: Readonly<Record<EmailLinkType, string>> = {
  recovery: "/account?notice=recovery",
};

const TOKEN_HASH = /^[A-Za-z0-9_-]{1,128}$/;

const isTokenHash = (value: unknown): value is string => typeof value === "string" && TOKEN_HASH.test(value);

const isEmailLinkType = (value: unknown): value is EmailLinkType => EMAIL_LINK_TYPES.some((type) => type === value);
