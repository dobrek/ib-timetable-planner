/**
 * The email-link types `/auth/confirm` accepts. The page is shared infrastructure for every Auth
 * email that carries a one-time link: S-402 added `recovery`, S-410 `invite`, and S-411 adds
 * `email_change`. A new type needs an entry here and in three records keyed by it, which the type
 * checker enforces: `LANDING_PATHS` below, and the page copy and failure route in
 * `confirm-page-state.ts`. A type outside this list is refused before GoTrue is ever called.
 */
export const EMAIL_LINK_TYPES = ["recovery", "invite"] as const;

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
 * Where a spent link lands, signed in, on the account page, which a user with no role can still
 * reach. A recovery adds a banner (`AccountPage.astro` reads `notice=recovery`). An invitation needs
 * no query string: the invitee is still fenced, and the page welcomes them from that state.
 */
export function landingPathFor(type: EmailLinkType): string {
  return LANDING_PATHS[type];
}

const LANDING_PATHS: Readonly<Record<EmailLinkType, string>> = {
  recovery: "/account?notice=recovery",
  invite: "/account",
};

const TOKEN_HASH = /^[A-Za-z0-9_-]{1,128}$/;

const isTokenHash = (value: unknown): value is string => typeof value === "string" && TOKEN_HASH.test(value);

const isEmailLinkType = (value: unknown): value is EmailLinkType => EMAIL_LINK_TYPES.some((type) => type === value);
