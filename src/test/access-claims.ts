/** The access-token claims the integration lane asserts on. */
export type AccessClaims = { role?: string; sub?: string; app_metadata?: { machine_role?: string } };

/**
 * An access token's payload, decoded WITHOUT verification: the signature is GoTrue's business, and
 * these claims are what RLS and the token hook judge the client by.
 *
 * Test lane only.
 */
export const decodeAccessClaims = (token: string): AccessClaims => {
  const payload = token.split(".")[1];
  if (!payload) throw new Error("access token is not a JWT");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as AccessClaims;
};
