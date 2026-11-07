/**
 * The board header's creator icon (S-407) is a button whose accessible name carries the whole
 * credit: "Created by <name> (<email>)", or "Created by <email>" when the user has no display name.
 * Match it on the email alone, never the name: `account.spec.ts` renames the shared author while
 * other specs run (e2e/CLAUDE.md).
 */
export const creditedTo = (email: string): RegExp => {
  const exact = escapeRegExp(email);
  return new RegExp(`^Created by (?:.+ \\(${exact}\\)|${exact})$`);
};

const escapeRegExp = (text: string): string => text.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
