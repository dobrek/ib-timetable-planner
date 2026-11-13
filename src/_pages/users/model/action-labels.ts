import type { RowAction } from "./user-rows";

type ActionLabel = {
  /** The link's text in the status cell. */
  text: string;
  /** Its accessible name on one person's row, so two rows' links are told apart. */
  nameFor: (person: string) => string;
};

/** The status cell's action wording. A `Record`, so an action added to `RowAction` does not compile until it is named. */
export const ACTION_LABELS: Record<RowAction, ActionLabel> = {
  reissue: { text: "Re-issue password", nameFor: (person) => `Re-issue password for ${person}` },
  resend: { text: "Re-send", nameFor: (person) => `Re-send invitation to ${person}` },
  revoke: { text: "Revoke", nameFor: (person) => `Revoke invitation for ${person}` },
  deactivate: { text: "Deactivate", nameFor: (person) => `Deactivate ${person}` },
  ban: { text: "Ban", nameFor: (person) => `Ban ${person}` },
  unban: { text: "Unban", nameFor: (person) => `Unban ${person}` },
  delete: { text: "Delete", nameFor: (person) => `Delete ${person}` },
  change_email: { text: "Change email", nameFor: (person) => `Change email for ${person}` },
  reactivate: { text: "Reactivate", nameFor: (person) => `Reactivate ${person}` },
};
