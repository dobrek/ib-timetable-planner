export type ProfileLabel = {
  primary: string;
  /** The email, shown under the name; null when there is no name and the email is already primary. */
  secondary: string | null;
};

/**
 * How the sidebar names the signed-in user (FR-413): the display name when set, with the email
 * beneath it so a look-alike name can't pass for a colleague; the email alone otherwise.
 */
export function profileLabel({ displayName, email }: { displayName: string | null; email: string }): ProfileLabel {
  return displayName ? { primary: displayName, secondary: email } : { primary: email, secondary: null };
}
